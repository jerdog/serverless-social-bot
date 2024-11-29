import { jest } from '@jest/globals';

// Make Jest globals available
global.jest = jest;
global.describe = jest.describe;
global.test = jest.test;
global.expect = jest.expect;
global.beforeAll = jest.beforeAll;
global.beforeEach = jest.beforeEach;
global.afterEach = jest.afterEach;
global.afterAll = jest.afterAll;
