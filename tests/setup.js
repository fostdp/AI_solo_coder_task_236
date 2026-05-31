const path = require('path');
const fs = require('fs');

const TEST_DATA_FILE = path.join(__dirname, 'test-data.json');
let globalApp = null;

beforeAll(() => {
    process.env.DATA_FILE = TEST_DATA_FILE;
    delete require.cache[require.resolve('../server')];
    const { app } = require('../server');
    globalApp = app;
    global.testApp = app;
});

beforeEach(() => {
    if (fs.existsSync(TEST_DATA_FILE)) {
        try {
            fs.unlinkSync(TEST_DATA_FILE);
        } catch (e) {}
    }
});

afterEach(() => {
    if (fs.existsSync(TEST_DATA_FILE)) {
        try {
            fs.unlinkSync(TEST_DATA_FILE);
        } catch (e) {}
    }
});

afterAll(() => {
    if (fs.existsSync(TEST_DATA_FILE)) {
        try {
            fs.unlinkSync(TEST_DATA_FILE);
        } catch (e) {}
    }
    globalApp = null;
    global.testApp = null;
    delete require.cache[require.resolve('../server')];
});
