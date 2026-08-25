/**
 * ES module entry point.
 *
 * The package is authored as CommonJS (the browser files are plain scripts), so
 * this wraps the CJS entry rather than duplicating it — one implementation, two
 * ways in. Named exports are declared explicitly because Node cannot infer them
 * from a CJS module.
 */
import agent from './index.js';

export const AgentConnection = agent.AgentConnection;
export const MySecurity = agent.MySecurity;
export const FileSystem = agent.FileSystem;
export const generateRandomAgentName = agent.generateRandomAgentName;

export default agent;
