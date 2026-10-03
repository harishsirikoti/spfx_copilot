const path = require('path');
const dotenv = require('dotenv');
const webpack = require('webpack');

module.exports = function (webpackConfig) {
  const projectRoot = path.resolve(__dirname, '../..');

  const envResult = dotenv.config({
    path: path.join(projectRoot, '.env')
  });

  if (envResult.error) {
    throw new Error(
      'Unable to load .env file. Create .env in the project root before building.'
    );
  }

  const requiredVariables = [
    'COPILOT_TOKEN_ENDPOINT',
    'ENTRA_TENANT_ID',
    'SPFX_CLIENT_ID',
    'COPILOT_SCOPE',
    'SHAREPOINT_CHAT_PAGE_URL'
  ];

  for (const variableName of requiredVariables) {
    if (!process.env[variableName]) {
      throw new Error(
        `Missing required environment variable: ${variableName}`
      );
    }
  }

  if (!webpackConfig.plugins) {
    webpackConfig.plugins = [];
  }

  webpackConfig.plugins.push(
    new webpack.DefinePlugin({
      'process.env.COPILOT_TOKEN_ENDPOINT': JSON.stringify(
        process.env.COPILOT_TOKEN_ENDPOINT
      ),
      'process.env.ENTRA_TENANT_ID': JSON.stringify(
        process.env.ENTRA_TENANT_ID
      ),
      'process.env.SPFX_CLIENT_ID': JSON.stringify(
        process.env.SPFX_CLIENT_ID
      ),
      'process.env.COPILOT_SCOPE': JSON.stringify(
        process.env.COPILOT_SCOPE
      ),
      'process.env.SHAREPOINT_CHAT_PAGE_URL': JSON.stringify(
        process.env.SHAREPOINT_CHAT_PAGE_URL
      )
    })
  );

  return webpackConfig;
};