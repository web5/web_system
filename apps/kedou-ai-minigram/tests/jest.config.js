module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  testMatch: ['**/tests/**/*.test.{js,ts}'],
  testEnvironmentOptions: {
    html: '<!DOCTYPE html><html><body><div id="app"></div></body></html>',
  },
};
