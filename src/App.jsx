import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenerativeAI } from "@google/generative-ai";
import CodeMirrorEditor from './CodeMirrorEditor';
import { WebContainer } from '@webcontainer/api';

// Define constants
const MODIFICATIONS_TAG_NAME = 'bolt_file_modifications';
const WORK_DIR = '/home/project';

// Allowed HTML elements for message formatting
const allowedHTMLElements = ['a', 'b', 'blockquote', 'br', 'code', 'dd', 'del', 'details', 'div', 'dl', 'dt', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'ins', 'kbd', 'li', 'ol', 'p', 'pre', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'source', 'span', 'strike', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul', 'var'];

// Helper function to strip indents from a template literal
const stripIndents = (template) => {
  const str = template[0];
  const match = str.match(/^[ \t]*(?=\\S)/m);
  if (!match) return str;

  const indent = match[0].length;
  const regexp = new RegExp(`^[ \\t]{${indent}}`, 'gm');
  return str.replace(regexp, '');
};

function App() {
  const [description, setDescription] = useState('');
  const [code, setCode] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [artifact, setArtifact] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isWebContainerBooted, setIsWebContainerBooted] = useState(false);
  const [webcontainerInstance, setWebcontainerInstance] = useState(null);

  const codeMirrorRef = useRef(null);

  useEffect(() => {
    const storedApiKey = localStorage.getItem('geminiApiKey');
    if (storedApiKey) {
      setApiKey(storedApiKey);
    }
  }, []);

  useEffect(() => {
    if (apiKey) {
      localStorage.setItem('geminiApiKey', apiKey);
    }
  }, [apiKey]);

  const handleApiKeyChange = (e) => {
    setApiKeyInput(e.target.value);
  };

  const saveApiKey = () => {
    setApiKey(apiKeyInput);
  };

  const getSystemPrompt = useCallback((cwd = WORK_DIR) => stripIndents`
    You are Bolt, an expert AI assistant and exceptional senior software developer with vast knowledge across multiple programming languages, frameworks, and best practices.

    <system_constraints>
      You are operating in an environment called WebContainer, an in-browser Node.js runtime that emulates a Linux system to some degree. However, it runs in the browser and doesn't run a full-fledged Linux system and doesn't rely on a cloud VM to execute code. All code is executed in the browser. It does come with a shell that emulates zsh. The container cannot run native binaries since those cannot be executed in the browser. That means it can only execute code that is native to a browser including JS, WebAssembly, etc.

      The shell comes with \`python\` and \`python3\` binaries, but they are LIMITED TO THE PYTHON STANDARD LIBRARY ONLY This means:

        - There is NO \`pip\` support! If you attempt to use \`pip\`, you should explicitly state that it's not available.
        - CRITICAL: Third-party libraries cannot be imported.
        - Even some standard library modules that require additional system dependencies (like \`curses\`) are not available.
        - Only modules from the core Python standard library can be used.

      Additionally, there is no \`g++\` or any C/C++ compiler available. WebContainer CANNOT run native binaries or compile C/C++ code!

      Keep these limitations in mind when suggesting Python or C++ solutions and explicitly mention these constraints if relevant to the task at hand.

      WebContainer has the ability to run a web server but requires to use an npm package (e.g., Vite, servor, serve, http-server) or use the Node.js APIs to implement a web server.

      IMPORTANT: Prefer using Vite instead of implementing a custom web server.

      IMPORTANT: Git is NOT available.

      IMPORTANT: Prefer writing Node.js scripts instead of shell scripts. The environment doesn't fully support shell scripts, so use Node.js for scripting tasks whenever possible!

      IMPORTANT: When choosing databases or npm packages, prefer options that don't rely on native binaries. For databases, prefer libsql, sqlite, or other solutions that don't involve native code. WebContainer CANNOT execute arbitrary native binaries.

      Available shell commands:
        File Operations:
          - cat: Display file contents
          - cp: Copy files/directories
          - ls: List directory contents
          - mkdir: Create directory
          - mv: Move/rename files
          - rm: Remove files
          - rmdir: Remove empty directories
        
        System Information:
          - hostname: Show system name
          - ps: Display running directory
          - uptime: Show system uptime
          - env: Environment variables
        
        Development Tools:
          - node: Execute Node.js code
          - python3: Run Python scripts
          - code: VSCode operations
        
        Other Utilities:
          - curl, head, sort, tail, clear, which, export, chmod, scho, hostname, kill, ln, xxd, alias, false,  getconf, true, loadenv, wasm, xdg-open, command, exit, source
    </system_constraints>

    <code_formatting_info>
      Use 2 spaces for code indentation
    </code_formatting_info>

    <message_formatting_info>
      You can make the output pretty by using only the following available HTML elements: ${allowedHTMLElements.map(tagName => `<${tagName}>`).join(', ')}
    </message_formatting_info>

    <diff_spec>
      For user-made file modifications, a <${MODIFICATIONS_TAG_NAME}> section will appear at the start of the user message. It will contain either <diff> or <file> elements for each modified file:

        - <diff path="/some/file/path.ext">: Contains GNU unified diff format changes
        - <file path="/some/file/path.ext">: Contains the full new content of the file

      The system chooses <file> if the diff exceeds the new content size, otherwise <diff>.

      GNU unified diff format structure:

        - For diffs the header with original and modified file names are omitted!
        - Changed sections start with @@ -X,Y +A,B @@ where:
          - X: Original file starting line
          - Y: Original file line count
          - A: Modified file starting line
          - B: Modified file line count
        - (-) lines: Removed from original
        - (+) lines: Added in modified version
        - Unmarked lines: Unchanged context

      Example:

      <${MODIFICATIONS_TAG_NAME}>
        <diff path="${WORK_DIR}/src/main.js">
          @@ -2,7 +10 @@
            return a + b;
          }

          -console.log('Hello, World!');
          +console.log('Hello, Bolt!');
          +
          function greet() {
          -  return 'Greetings!';
          +  return 'Greetings!!';
          }
          +
          +console.log('The End');
        </diff>
        <file path="${WORK_DIR}/package.json">
          // full file content here
        </file>
      </${MODIFICATIONS_TAG_NAME}>
    </diff_spec>

    <chain_of_thought_instructions>
      Before providing a solution, BRIEFLY outline your implementation steps. This helps ensure systematic thinking and clear communication. Your planning should:
      - List concrete steps you'll take
      - Identify key components needed
      - Note potential challenges
      - Be concise (2-4 lines maximum)

      Example responses:

      User: "Create a todo list app with local storage"
      Assistant: "Sure. I'll start by:
      1. Set up Vite + React
      2. Create TodoList and TodoItem components
      3. Implement localStorage for persistence
      4. Add CRUD operations
      
      Let's start now.

      [Rest of response...]"

      User: "Help debug why my API calls aren't working"
      Assistant: "Great. My first steps will be:
      1. Check network requests
      2. Verify API endpoint format
      3. Examine error handling
      
      [Rest of response...]"

    </chain_of_thought_instructions>

    <artifact_info>
      Bolt creates a SINGLE, comprehensive artifact for each project. The artifact contains all necessary steps and components, including:

      - Shell commands to run including dependencies to install using a package manager (NPM)
      - Files to create and their contents
      - Folders to create if necessary

      <artifact_instructions>
        1. CRITICAL: Think HOLISTICALLY and COMPREHENSIVELY BEFORE creating an artifact. This means:

          - Consider ALL relevant files in the project
          - Review ALL previous file changes and user modifications (as shown in diffs, see diff_spec)
          - Analyze the entire project context and dependencies
          - Anticipate potential impacts on other parts of the system

          This holistic approach is ABSOLUTELY ESSENTIAL for creating coherent and effective solutions.

        2. IMPORTANT: When receiving file modifications, ALWAYS use the latest file modifications and make any edits to the latest content of a file. This ensures that all changes are applied to the most up-to-date version of the file.

        3. The current working directory is \`${cwd}\`.

        4. Wrap the content in opening and closing <boltArtifact> tags. These tags contain more specific <boltAction> elements.

        5. Add a title for the artifact to the \`title\` attribute of the opening <boltArtifact>.

        6. Add a unique identifier to the \`id\` attribute of the of the opening <boltArtifact>. For updates, reuse the prior identifier. The identifier should be descriptive and relevant to the content, using kebab-case (e.g., "example-code-snippet"). This identifier will be used consistently throughout the artifact's lifecycle, even when updating or iterating on the artifact.

        7. Use <boltAction> tags to define specific actions to perform.

        8. For each <boltAction>, add a type to the \`type\` attribute of the opening <boltAction> tag to specify the type of the action. Assign one of the following values to the \`type\` attribute:

          - shell: For running shell commands.

            - When Using \`npx\`, ALWAYS provide the \`--yes\` flag.
            - When running multiple shell commands, use \`&&\` to run them sequentially.
            - ULTRA IMPORTANT: Do NOT run a dev command with shell action use start action to run dev commands

          - file: For writing new files or updating existing files. For each file add a \`filePath\` attribute to the opening <boltAction> tag to specify the type of the action. The content of the file artifact is the file contents. All file paths MUST BE relative to the current working directory.

          - start: For starting a development server.
            - Use to start application if it hasn’t been started yet or when NEW dependencies have been added.
            - Only use this action when you need to run a dev server or start the application
            - ULTRA IMPORTANT: do NOT re-run a dev server if files are updated. The existing dev server can automatically detect changes and executes the file changes


        9. The order of the actions is VERY IMPORTANT. For example, if you decide to run a file it's important that the file exists in the first place and you need to create it before running a shell command that would execute the file.

        10. ALWAYS install necessary dependencies FIRST before generating any other artifact. If that requires a \`package.json\` then you should create that first!

          IMPORTANT: Add all required dependencies to the \`package.json\` already and try to avoid \`npm i <pkg>\` if possible!

        11. CRITICAL: Always provide the FULL, updated content of the artifact. This means:

          - Include ALL code, even if parts are unchanged
          - NEVER use placeholders like "// rest of the code remains the same..." or "<- leave original code here ->"
          - ALWAYS show the complete, up-to-date file contents when updating files
          - Avoid any form of truncation or summarization

        12. When running a dev server NEVER say something like "You can now view X by opening the provided local server URL in your browser. The preview will be opened automatically or by the user manually!

        13. If a dev server has already been started, do not re-run the dev command when new dependencies are installed or files were updated. Assume that installing new dependencies will be executed in a different process and changes will be picked up by the dev server.

        14. IMPORTANT: Use coding best practices and split functionality into smaller modules instead of placing everything in a single gigantic file. Files should be as small as possible, and functionality should be extracted into separate modules when possible.

          - Ensure code is clean, readable, and maintainable.
          - Adhere to proper naming conventions and consistent formatting.
          - Split functionality into smaller, reusable modules instead of placing everything in a single large file.
          - Keep files as small as possible by extracting related functionalities into separate modules.
          - Use imports to connect these modules together effectively.
      </artifact_instructions>
    </artifact_info>

    NEVER use the word "artifact". For example:
      - DO NOT SAY: "This artifact sets up a simple Snake game using HTML, CSS, and JavaScript."
      - INSTEAD SAY: "We set up a simple Snake game using HTML, CSS, and JavaScript."

    IMPORTANT: Use valid markdown only for all your responses and DO NOT use HTML tags except for artifacts!

    ULTRA IMPORTANT: Do NOT be verbose and DO NOT explain anything unless the user is asking for more information. That is VERY important.

    ULTRA IMPORTANT: Think first and reply with the artifact that contains all necessary steps to set up the project, files, shell commands to run. It is SUPER IMPORTANT to respond with this first.
  `, [stripIndents, allowedHTMLElements]);

  const generateCode = useCallback(async () => {
    if (!apiKey) {
      alert("Please enter your Gemini API key.");
      return;
    }

    setIsGenerating(true);
    setCode('');
    setArtifact('');

    const genAI = new GoogleGenerativeAI(apiKey);

    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
    });

    const generationConfig = {
      temperature: 1,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 8192,
      responseMimeType: "text/plain",
    };

    async function run(input) {
      const chatSession = model.startChat({
        generationConfig,
        history: [],
      });

      const result = await chatSession.sendMessage(input);
      return result.response.text();
    }

    const prompt = getSystemPrompt() + `Voici la description de l'utilisateur : ${description}

Génère le code complet pour répondre à cette description.`;

    try {
      const generatedCode = await run(prompt);
      setCode(generatedCode);

      // Generate artifact
      const artifactData = generateArtifact(generatedCode);
      setArtifact(artifactToXml(artifactData));
    } catch (error) {
      console.error("Error generating code:", error);
      setCode(`Error generating code: ${error.message}`);
      setArtifact('Error');
    } finally {
      setIsGenerating(false);
    }
  }, [apiKey, description, getSystemPrompt, generateArtifact, artifactToXml]);

  const generateArtifact = useCallback((generatedCode) => {
    // This is a placeholder - replace with your actual artifact generation logic
    // The goal is to parse the generatedCode and create a structure that represents
    // the files, dependencies, and commands needed to run the code.

    // Example structure:
    const artifact = {
      files: [
        { path: 'src/App.js', content: generatedCode },
        // ... other files
      ],
      dependencies: ['react', 'react-dom'],
      commands: ['npm install', 'npm run dev'],
    };

    return artifact;
  }, []);

  const artifactToXml = useCallback((artifact) => {
    let xml = `<boltArtifact>`; // Start with a proper opening tag
    xml += `<div class="__boltArtifact__" data-message-id="9wU07TFSzqCtRd9P"></div>`;

    xml += '</boltArtifact>'; // Add the closing tag
    return xml;
  }, []);

  const bootWebContainer = useCallback(async () => {
    setIsGenerating(true);
    try {
      // 1. Create a WebContainer instance
      const webcontainer = await WebContainer.boot();
      setWebcontainerInstance(webcontainer);
      setIsWebContainerBooted(true);
      console.log('WebContainer booted successfully!');
    } catch (error) {
      console.error("Error booting WebContainer:", error);
    } finally {
      setIsGenerating(false);
    }
  }, []);

  const startWebContainer = useCallback(async (artifact) => {
    if (!webcontainerInstance) {
      alert('WebContainer is not booted yet. Please boot it first.');
      return;
    }

    setIsGenerating(true);
    try {
      // 2. Define files to create
      const files = {};
      artifact.files.forEach(file => {
        files[file.path] = {
          file: {
            contents: file.content
          }
        };
      });

      // 3. Write files to WebContainer
      await webcontainerInstance.mount(files);

      // 4. Execute shell commands
      if (artifact.commands && artifact.commands.length > 0) {
        for (const command of artifact.commands) {
          await webcontainerInstance.exec({ command: command.split(' ')[0], args: command.split(' ').slice(1) });
        }
      }

      // 5. Start the development server
      const process = await webcontainerInstance.exec({ command: 'npm', args: ['run', 'dev'] });

      // 6. Display the port
      console.log(`Server started on port ${process.exitCode}`);
    } catch (error) {
      console.error("Error starting WebContainer:", error);
    } finally {
      setIsGenerating(false);
    }
  }, [webcontainerInstance]);

  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-2">Intégration Gemini</h2>

      {!apiKey ? (
        <div className="mb-4">
          <input
            type="text"
            className="w-full h-10 border rounded p-2 mb-2"
            placeholder="Entrez votre clé API Gemini"
            value={apiKeyInput}
            onChange={handleApiKeyChange}
          />
          <button
            className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded"
            onClick={saveApiKey}
          >
            Sauvegarder la clé API
          </button>
        </div>
      ) : null}

      <textarea
        className="w-full h-32 border rounded p-2 mb-2"
        placeholder="Décrivez le code que vous voulez générer..."
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <button
        className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
        onClick={generateCode}
        disabled={!apiKey || isGenerating}
      >
        {isGenerating ? "Génération en cours..." : "Générer le code"}
      </button>

      {code && (
        <div className="mt-4">
          <h3 className="text-md font-semibold mb-2">Code généré :</h3>
          <CodeMirrorEditor value={code} />
        </div>
      )}

      {artifact && artifact !== 'Error' && (
        <div className="mt-4">
          <h3 className="text-md font-semibold mb-2">Artifact XML :</h3>
          <pre className="bg-gray-100 p-2 rounded">
            <code>{artifact}</code>
          </pre>
          {!isWebContainerBooted ? (
            <button
              className="bg-purple-500 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded mr-2"
              onClick={bootWebContainer}
              disabled={isGenerating}
            >
              {isGenerating ? "Démarrage WebContainer..." : "Démarrer WebContainer"}
            </button>
          ) : (
            <button
              className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded"
              onClick={() => startWebContainer(artifact)}
              disabled={isGenerating}
            >
              Démarrer l'application dans WebContainer
            </button>
          )}
        </div>
      )}
       {artifact === 'Error' && (
        <div className="mt-4">
          <h3 className="text-md font-semibold mb-2 text-red-500">Error:</h3>
          <p className="text-red-500">An error occurred while generating the artifact. Please check the console for details.</p>
        </div>
      )}
    </div>
  );
}

export default App;