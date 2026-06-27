# **Pi AI Debugger: bug discovery, validation and fixing**

This document serves as the official architectural blueprint and feature specification for the Pi AI Debugger, an autonomous, loop-based AI Observability and Self-Healing Agent integrated directly into the Pi Terminal User Interface (TUI).

## **1\. Core Goal & System Architecture**

The primary objective of the Pi AI Debugger is to provide an automated, localized debugging loop for applications running within their current working directory. By tightly coupling runtime telemetry with LLM-driven code manipulation, it eliminates manual root-cause analysis.

* **Working Directory Context:** The agent operates strictly within the current working directory of the target codebase, maintaining complete awareness of local files, dependencies, and configurations.  
* **Local Listening Server:** Upon activation, the debugger instantiates a background HTTP log server (typically listening on Port 8866\) specifically engineered to capture structured JSON telemetry packets emitted by the application.  
* **Autonomous Code Injection:** The underlying LLM uses file-writing tools to dynamically inject lightweight, targeted logging statements into source code files. These statements capture application state variables and execution paths, streaming them back to the listening server.

## **2\. Terminal Interface Integration**

The system is designed to be low-friction and stays entirely within the developer's terminal environment via the Pi TUI.

* **Instrumentation UI Area:** Positioned inline, right above the bottom two status and command bars, this dedicated screen real estate serves as a live, scrolling telemetry feed showing log packets as they hit the listening server.  
* **Command-Line Activation:** Execution is managed cleanly using dedicated slash commands entered at the bottom prompt bar.

## **3\. Application Environment Modes**

The debugger dynamically scales its interaction model based on where the application is executing. The network topography and execution paths are explicitly differentiated via two core slash commands:

| Command | Environment Mode | Telemetry Hook | Code Execution Strategy   |
| :---- | :---- | :---- | :---- |
| /debugger | Local Mode | Routes telemetry directly to localhost:8080. | **Automated:** The agent utilizes internal file/source manipulation tools to modify code files inside the working directory automatically. |
| /debugger remote | Remote Mode | Routes telemetry via an ngrok public tunnel back to Port 8866\. | **Instructional:** The agent generates precise, copy-pasteable code patches and asks the user to manually apply them to the remote environment. |
| /debugger stop | All | None | Terminates the active debugging session and cleans up any injected telemetry hooks. |

## **4\. Core Automation Loops**

The agent executes its lifecycle through three continuous, deterministic operational phases:

### **Phase 1: Progressive Context Gathering**

When the agent lacks sufficient visibility into a failure, the LLM will need to collect data in an open-ended mixture of text data, pasted logs, or local file paths pointing to system screenshots.

* **High-Context Inputs:** If the user submits a comprehensive stack trace or a clear error snippet, the engine skips further prompts and instantly drafts a hypothesis. Local screenshot paths are processed via a multimodal LLM check to extract text indicators inline.  
* **Ambiguous Inputs:** If given vague symptoms, the agent progressively asks hyper-targeted follow-up questions to pinpoint the exact target file and anomalous behavior.

### **Phase 2: Hypothesis & Testing Loop**

Once a file location or system boundaries are identified, the LLM constructs an initial defect hypothesis.

1. It injects custom verification or telemetry log statements to capture the variables surrounding the suspected failure point.  
2. It systematically monitors incoming logs via the live TUI instrumentation view.  
3. If the log data disproves the theory, the agent refines its understanding, modifies the telemetry points, and restarts the check until the bug is reliably reproduced and isolated.  
4. Once the bug has been properly identified and proved by log data, the next step is creating a fix.

#### **Testing Loop Steps:**

1. The LLM will first create a hypothesis of the bug, indicating what is the potential cause, and then listing out the file(s) and functions that is the potential cause.  
2. The LLM will then create a fix based on its hypothesis.  When the fix has been implemented, the LLM will provide step by step instructions for the user to try and reproduce the bug.  The instruction will also ask the user to provide one of two responses, “Bug Fixed” or “Continue to Debug”.  Selecting “Bug Fixed” is when the user could validate the fix.  Selecting “Continue to Debug” is when the bug still exist.    
3. If we still need to continue to debug, the LLM will first need to remove the changes made in step (2) \- both the logging statements and the fix.  The log file created, could still remain.  Once the cleanup is complete, the LLM will need to jump back to step (1) and start over the process.  
4. If the bug is fixed, the system will move to cleanup mode, and remove all telemetry and logging code, but keeping the fix in the codebase.  
5. Once cleanup is complete, the system will ask the user if they would like to exit out of “Debug” mode or “Continue”.

### **Phase 3: Automated Resolution**

With the root cause mathematically isolated and proven by empirical log data, the debugger moves into the final phase.  The LLM will remove the logging code in the codebase, keep the code that fixed the bug, and then do a final validation to make sure the bug has been fixed, and that removing the logging code didn’t impact the codebase.

# **Basic Requirements**

## **Server**

The server will be an http server, running locally.  These are the following requirements:

* By default the server will be running on port 8866, but can be configurable  
* It will be used to receive post requests  
  * When a request is received, a simple 200 OK with a JSON response like {"status": "success"} is sent  
  * If an invalid JSON is received, a 400 bad request will be returned  
  * If the method is incorrect (i.e. GET), a 405 method not allowed should be sent back  
  * The JSON format should be validated against a specific format shown below  
* The request body will be in the form of JSON  
* Once a request is received, it will be saved into a log file.  The log file will have a random name generated using 8 alphanumeric characters (i.e. abas1234.log)  
  * The log file will be saved under the projects .pi/logs/ folder  
  * If the directory didn’t exist, create it  
  * The JSON will be dumped as raw JSON on a new line

### **JSON Format**

Sample Log:  
{  
  "log\_id": "1698844392123-4",  
  "event\_timestamp": "2023-11-01T14:53:12.123Z",  
  "level": "ERROR",  
  "source": {  
    "file": "auth\_controller.py",  
    "line": 145,  
    "function": "validate\_user\_token"  
  },  
  "message": "Failed to decrypt user token. Token length mismatch.",  
  "variables": {  
    "token\_length": 12,  
    "expected\_length": 256,  
    "user\_id": "user\_8842"  
  },  
  "stack\_trace": "Traceback (most recent call last):\\n  File \\"auth\_controller.py\\", line 140..."  
}

####  **Top-Level Identifiers & Timing**

* log\_id: A unique identifier for this specific log entry. By combining a timestamp and a sequence number (like 1698844392123-4), it acts as a counter to ensure logs aren't lost during transmission and can be sorted chronologically even if the server receives them out of order.  
* event\_timestamp: The exact date and time (in ISO 8601 format) the event occurred *on the client machine*. This is crucial because there can be network delays; you want to know when the error actually happened in the code, not just when your server finished writing the file.  
* level: The severity of the log. Common values include TRACE, DEBUG, INFO, WARN, ERROR, or FATAL. This allows you to quickly filter logs to only see critical errors or ignore routine milestone checks.

#### **Source Context (Where it happened)**

* source: An object containing the exact location in your codebase where the log was triggered.  
  * file: The name of the source code file (e.g., auth\_controller.py).  
  * line: The exact line number in that file. This is perfect for your "placeholder" use case to verify if code execution reaches a certain point.  
  * function: The name of the function or method executing when the log was generated. This helps group related errors together without needing to open the file.

#### **The Payload (What happened)**

* message: A human-readable, plain English description of the event or error (e.g., "Failed to decrypt user token. Token length mismatch."). This gives you immediate context before you even look at the code.  
* variables: A dynamic object containing the actual values of variables at the exact moment the log was triggered. As you mentioned, this is where you can output concatenated strings, math results, or variable states (e.g., comparing token\_length vs expected\_length) to prove *why* the error occurred.  
* stack\_trace: The raw execution path that led to this log. If the log is an actual error/exception, this trace shows exactly which functions called which other functions, leading all the way back to the root cause of the failure.

## **Instrumentation**

In Pi Coding Agent, there is a section that allows for instrumentation, i’d like to place this at the widget location above the editor.  Some context for Pi:

* ctx.ui.setWidget("id", lines | fn, {placement})  
* For design, I have wireframes \- please remember to ask for the wireframe images as reference

### **Instrumentation States**

The instrumentation area has several states:

1. AWAITING CONTEXT \- This is when the LLM has no context about the bug/error.  In this state, its waiting for more information to begin.  
2. AWAITING CONTEXT: AMBIGUOUS \- This is when the user has given some context, but its too ambiguous for the LLM to determine the issue.  The LLM will attempt to provide some context, but will continue to ask for more specific information allowing for a more accurate determination of the bug/error.  
3. PARSING ASSET \- This is when the user uploads file like content (i.e. images, pdfs), and the LLM will need to read the content (using the model or skills if necessary).  LLM will output what it has extracted as a source for its analysis  
4. HYPOTHESIS & BUG VALIDATION \- When there is enough context for the LLM a hypothesis of the potential problem will be determined.  It will be during this time, that the LLM will also identify locations in files that it will insert logging to validate its assumptions.  Validation means that the logging will help determine if the bug discovery could be reasonably determined and repeated in generating the error.  In order to test, the LLM may require the user to repeat certain behavior that creates the bug.  
5. FIXING BUG \- Once the LLM can reliably reproduce the bug and trace it through logs, the LLM will attempt to fix the bug.  Fixing bug would involve deploying a fix, and then asking the user to attempt to perform the behavior that creates the bug.  The log will trace to see if the bug was fixed or not.  If the implemented update couldn’t fix the bug, the LLM will attempt another fix.  The LLM will again, ask the user to test again to see if the bug was fixed through the log traces.  The LLM will attempt 3 fixes (can be configured).  After the 3rd try and the bug still exist, the LLM will require more context to determine where the error is being generated.  This essentially is going back to step 4, with a new hypothesis and the repeat the flow of steps 4 and 5\.  
6. BUG FIXED \- Once a bug has been deemed as fixed, the LLM will remove any code snippets used to generate logs, but keeping the bugfix code in place.  Once all logging snippets have been removed, the LLM will indicate that the user can do a final test and see if the bug exists.  
7. DEBUG SUMMARY \- When complete, a summary of the bug and fixes applied will be provided to the user

### **Instrumentation Layout Requirements**

#### **Header**

Provides status of the current debugger.  Should include:

* Status States  
* LIVE LOGGING message \- indicating that the system is successful in generating logs from the codebase  
* Port information for inbounds ports for the debugger to receive data  
* NOTE:  On local, if you are debugging a frontend script like JS or TS, you can post/fetch to the endpoint given

#### **Bug Summary**

This is where the description of the bug being investigated will reside.  It is a static display of what the bug is, and can span multiple lines.  It will be empty until the LLM has enough context to describe the bug.  

#### **Hypothesis Statement**

This is where the hypothesis will reside.  Its just a static display of what the hypothesis is that we are testing, and can span multiple lines.  There will also be a hypothesis counter, if a solution fails, the LLM will need to create another hypothesis to test, so this is the counter for that.  

#### **Log Stream**

The log stream only displays when the LLM has inserted code that sends log data to the server.  This area simply displays log data in a prettier format.  The “window” would also allow for scrolling through the log, and the user will be able to also scroll back up to review any logs that have scrolled past.

#### **Body**

The body is for multi-purpose use to stream the LLM’s questions for us.  It is also a scrollable window of information.  This area could contain, the LLM asking for more context, the LLM asking for next steps and providing response confirmation buttons (i.e. Bug Fixed… etc)

## **Log Snippet Code Injection**

For adding log snippets, the most important requirement that the code needs to adhere to is the JSON format and the comment statements to identify the snippet.  These are the general requirements:

* The code for sending a POST request to the server with JSON \- the LLM can determine the best way this can be achieved based on the language and the codebase  
* The start and comment delimiters of the snippet \- we want to have comment delimiters that allow for identification of the snippet.  The snippet should contain a string name, and an ID to help the LLM identify the snippet that got added.  For example:  
  /\* AI\_DEBUG\_SNIPPET\_START:ID=1 \*/ fetch(....) /\* AI\_DEBUG\_SNIPPET\_END \*/  
* The ID can help the LLM determine the exact location of specific snippets if multiple snippets were added into the codebase

## **Log Snippet Code Cleanup**

When the fix has been accepted, the LLM will need to remove all instrumentation and snippets added to the code.  The LLM will be able to identify snippets added through the comment delimiters.  

