module.exports = {
  moduleFileExtensions: ["ts", "js"],
  transform: {
    // cookie@2 (through light-my-request) and web-push@4 with its nested
    // proxy dependencies are published ESM-only. Specs run as CommonJS, so
    // exactly these subtrees are transpiled; every other node_modules file
    // stays raw because transformIgnorePatterns no longer excludes it.
    "node_modules/(?:cookie|web-push|proxy-agent-negotiate)/.+\\.(ts|tsx|js)$": [
      "@swc/jest",
      {
        jsc: {
          target: "es2020",
        },
      },
    ],
    "^.+\\.(ts|tsx)$": [
      "@swc/jest",
      {
        jsc: {
          target: "es2020",
        },
      },
    ],
  },
  transformIgnorePatterns: [],
  coverageProvider: "v8",
  moduleNameMapper: {
    "^uuid$": "<rootDir>/src/__mocks__/uuid.ts",
  },
  testMatch: ["/**/src/**/*.spec.(ts|js)"],
  testEnvironment: "node",
};
