const { google } = require('googleapis');
const fs = require('fs').promises;
const path = require('path');

async function getGoogleDriveClient() {
  // Implement Google Drive authentication
  // You'll need to set up OAuth 2.0 and get credentials
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  // Set credentials from stored token
  oauth2Client.setCredentials({
    access_token: process.env.GOOGLE_ACCESS_TOKEN
  });

  return google.drive({ version: 'v3', auth: oauth2Client });
}

async function listGoogleDocs() {
  const drive = await getGoogleDriveClient();
  
  // List markdown files in Google Drive
  const response = await drive.files.list({
    q: "mimeType='text/markdown'",
    fields: 'files(id, name)'
  });

  return response.data.files;
}

async function downloadMarkdownFiles() {
  const drive = await getGoogleDriveClient();
  const docs = await listGoogleDocs();

  const downloadedFiles = await Promise.all(
    docs.map(async (doc) => {
      const response = await drive.files.get({
        fileId: doc.id,
        alt: 'media'
      });

      return {
        name: doc.name,
        content: response.data
      };
    })
  );

  return downloadedFiles;
}

async function uploadConvertedFile(originalFileName, docxBuffer) {
  const drive = await getGoogleDriveClient();

  // Create a new file in the 'Converted' folder
  const fileMetadata = {
    name: `${path.parse(originalFileName).name}_converted.docx`,
    parents: [process.env.GOOGLE_DRIVE_CONVERTED_FOLDER_ID]
  };

  const media = {
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    body: docxBuffer
  };

  const file = await drive.files.create({
    resource: fileMetadata,
    media: media,
    fields: 'id'
  });

  return file.data;
}

module.exports = {
  listGoogleDocs,
  downloadMarkdownFiles,
  uploadConvertedFile
};