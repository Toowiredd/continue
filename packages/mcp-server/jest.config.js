module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: false,
        diagnostics: false
      },
    ],
  },
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^core/(.*)$": "<rootDir>/../../core/$1",
    "^core$": "<rootDir>/../../core/index",
    "^uuid$": require.resolve("uuid")
  }
};
