#!/usr/bin/env node
// Helper to make CDP calls to a specific port
const PORT = process.env.CHROME_PORT || 9222;
const path = require('path');

// Just forward to cdp.js with the port
process.env.CDP_PORT = PORT;
require('./cdp.js');