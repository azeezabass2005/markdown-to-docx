const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const dotenv = require('dotenv');
const axios = require('axios');
const marked = require('marked');
const AdmZip = require('adm-zip');
const { DOMParser } = require('xmldom');

dotenv.config();

const app = express();

// Middleware
app.use(cors({
  origin: 'http://localhost:5173', // Your frontend URL
  credentials: true
}));
app.use(express.json());

// OAuth Client Configuration
const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URL
);

// Authentication Middleware
const authenticateGoogle = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  try {
    // Set the credentials with the access token
    oauth2Client.setCredentials({ access_token: token });

    // Verify token with Google
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();

    req.user = userInfo.data;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// Google OAuth Routes
app.get('/auth/google', (req, res) => {
  const scopes = [
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/documents',
    'https://www.googleapis.com/auth/drive.metadata.readonly',
    'https://www.googleapis.com/auth/drive.appdata',
    'https://www.googleapis.com/auth/drive.appfolder',
    'https://www.googleapis.com/auth/drive.resource'
  ];

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent'
  });

  res.json({ authUrl: url });
});

// OAuth Callback (unchanged)
app.post('/auth/google/callback', async (req, res) => {
  const { code } = req.body;

  if (!code) {
    return res.status(400).json({
      message: 'No authorization code provided'
    });
  }

  try {
    // Exchange authorization code for tokens
    const { tokens } = await oauth2Client.getToken(code);

    // Validate tokens
    if (!tokens.access_token) {
      return res.status(400).json({
        message: 'Failed to retrieve access token'
      });
    }

    // Set credentials for future API calls
    oauth2Client.setCredentials(tokens);

    // Fetch user info
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();

    res.json({
      message: 'Authentication successful',
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      user: userInfo.data
    });
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({
      message: 'Authentication failed',
      error: error.message
    });
  }
});

// Create Converted Folder in Google Drive
async function createConvertedFolder(drive) {
  try {
    const folderMetadata = {
      name: 'Converted Markdown Files',
      mimeType: 'application/vnd.google-apps.folder'
    };
    const folder = await drive.files.create({
      resource: folderMetadata,
      fields: 'id'
    });
    return folder.data.id;
  } catch (error) {
    console.error('Error creating folder:', error);
    throw error;
  }
}

// Extract Document Content Safely
function extractDocumentContent(docContent) {
  try {
    // Flatten content extraction with more robust handling
    const contentParts = [];

    docContent.body.content.forEach(section => {
      if (section.paragraph && section.paragraph.elements) {
        section.paragraph.elements.forEach(element => {
          if (element.textRun && element.textRun.content) {
            contentParts.push(element.textRun.content);
          }
        });
      }
    });

    return contentParts.join('\n');
  } catch (error) {
    console.error('Content extraction error:', error);
    return '';
  }
}

// Docs Route - Find Markdown-like Documents
app.get('/api/docs', authenticateGoogle, async (req, res) => {
  try {
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const docs = google.docs({ version: 'v1', auth: oauth2Client });

    // Search for Google Docs files with broader permissions
    const response = await drive.files.list({
      q: "mimeType='application/vnd.google-apps.document'",
      fields: 'files(id, name, permissions)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });

    // Filter and verify docs with markdown-like content
    const markdownDocs = [];

    for (const file of response.data.files) {
      try {
        // Get the document content
        const docContent = await docs.documents.get({
          documentId: file.id
        });

        // Extract content
        const content = extractDocumentContent(docContent.data);

        // Basic markdown detection (you can refine this logic)
        if (
            content.includes('# ') || // Headers
            content.includes('## ') ||
            content.includes('**') || // Bold
            content.includes('*') ||   // Italic
            content.includes('- ') ||  // Lists
            content.includes('```')    // Code blocks
        ) {
          markdownDocs.push(file);
        }
      } catch (error) {
        console.error(`Error processing doc ${file.id}:`, error);
      }
    }

    res.json(markdownDocs);
  } catch (error) {
    console.error('Full error details:', error);
    res.status(500).json({
      error: 'Insufficient Permission',
      details: error.message
    });
  }
});

// Conversion Utilities
function htmlToGoogleDocsStructure(htmlContent) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlContent, 'text/html');

  const requests = [];
  let currentIndex = 1;

  const addFormattedText = (text, formatting = {}) => {
    requests.push({
      insertText: {
        location: { index: currentIndex },
        text: text,
      },
    });

    if (Object.keys(formatting).length > 0) {
      requests.push({
        updateTextStyle: {
          range: {
            startIndex: currentIndex,
            endIndex: currentIndex + text.length,
          },
          textStyle: formatting,
          fields: Object.keys(formatting).join(','),
        },
      });
    }

    currentIndex += text.length;
  };

  const elements = doc.body.children;

  Array.from(elements).forEach((element) => {
    switch (element.tagName.toLowerCase()) {
      case 'h1':
        addFormattedText(element.textContent + '\n', {
          bold: true,
          fontSize: { magnitude: 24, unit: 'PT' },
        });
        break;
      case 'h2':
        addFormattedText(element.textContent + '\n', {
          bold: true,
          fontSize: { magnitude: 20, unit: 'PT' },
        });
        break;
      case 'p':
        addFormattedText(element.textContent + '\n');
        break;
      case 'ul':
        Array.from(element.children).forEach((li) => {
          addFormattedText('• ' + li.textContent + '\n');
        });
        break;
      case 'code':
        addFormattedText(element.textContent + '\n', {
          backgroundColor: { color: { rgbColor: { red: 0.95, green: 0.95, blue: 0.95 } } },
          fontFamily: 'Courier New',
        });
        break;
      default:
        addFormattedText(element.textContent + '\n');
    }
  });

  return requests;
}

// Conversion Route
app.post('/api/convert', authenticateGoogle, async (req, res) => {
  try {
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const docs = google.docs({ version: 'v1', auth: oauth2Client });

    // Create a converted folder
    const folderMetadata = {
      name: 'Converted Markdown Files',
      mimeType: 'application/vnd.google-apps.folder'
    };
    const folder = await drive.files.create({
      resource: folderMetadata,
      fields: 'id'
    });
    const convertedFolderId = folder.data.id;

    // Search for Google Docs files
    const fileListResponse = await drive.files.list({
      q: "mimeType='application/vnd.google-apps.document'",
      pageSize: 100,
      fields: 'files(id, name)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });

    const markdownFiles = [];
    const convertedFiles = [];
    const zip = new AdmZip();

    for (const file of fileListResponse.data.files) {
      try {
        // Get the document content
        const docContent = await docs.documents.get({
          documentId: file.id
        });

        // Extract content (your existing extraction method)
        const rawContent = docContent.data.body.content
            .filter(section => section.paragraph && section.paragraph.elements)
            .map(section =>
                section.paragraph.elements
                    .filter(element => element.textRun && element.textRun.content)
                    .map(element => element.textRun.content)
                    .join('')
            )
            .join('\n');

        if (
            rawContent.includes('# ') ||
            rawContent.includes('## ') ||
            rawContent.includes('**') ||
            rawContent.includes('*') ||
            rawContent.includes('- ') ||
            rawContent.includes('```')
        ) {
          // Convert markdown to HTML
          const htmlContent = marked.parse(rawContent);

          // Convert HTML to Google Docs structure
          const requests = htmlToGoogleDocsStructure(htmlContent);

          // Create a new Google Docs file
          const docsFile = await docs.documents.create({
            resource: {
              title: `Converted-${file.name}`
            }
          });

          // Batch update the document with formatted content
          await docs.documents.batchUpdate({
            documentId: docsFile.data.documentId,
            resource: { requests }
          });

          // Move the file to converted folder
          await drive.files.update({
            fileId: docsFile.data.documentId,
            addParents: convertedFolderId,
            fields: 'id, parents',
            supportsAllDrives: true
          });

          // Export as PDF and add to zip
          // const pdfContent = await drive.files.export({
          //   fileId: docsFile.data.documentId,
          //   mimeType: 'application/pdf'
          // });
          const pdfResponse = await drive.files.export(
              {
                fileId: docsFile.data.documentId,
                mimeType: 'application/pdf'
              },
              { responseType: 'arraybuffer' } // Ensure the response is an ArrayBuffer
          );

// Convert ArrayBuffer to Buffer
          const pdfBuffer = Buffer.from(pdfResponse.data);

          // Ensure we're working with a buffer for the PDF
          // const pdfBuffer = Buffer.from(pdfContent.data);

          zip.addFile(`${file.name}.pdf`, pdfBuffer);

          convertedFiles.push({
            originalFileName: file.name,
            convertedFileName: `${file.name}.pdf`,
            status: 'converted'
          });
        }
      } catch (fileError) {
        console.error(`Error processing file ${file.id}:`, fileError);
        convertedFiles.push({
          originalFileName: file.name,
          status: 'failed',
          error: fileError.message
        });
      }
    }

    // Generate zip file
    const zipBuffer = zip.toBuffer();

    res.json({
      totalFiles: markdownFiles.length,
      convertedFiles,
      zipDownloadLink: `/api/download-zip?token=${req.headers.authorization.split(' ')[1]}`
    });

    // Store zip temporarily
    global.convertedZip = zipBuffer;
  } catch (error) {
    console.error('Conversion error:', error);
    res.status(500).json({
      error: 'Conversion Failed',
      details: error.message
    });
  }
});


// Conversion Route
app.post('/api/convert-2', authenticateGoogle, async (req, res) => {
  try {
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const docs = google.docs({ version: 'v1', auth: oauth2Client });

    // Create a converted folder
    const convertedFolderId = await createConvertedFolder(drive);

    // Search for Google Docs files with broader permissions
    const fileListResponse = await drive.files.list({
      q: "mimeType='application/vnd.google-apps.document'",
      pageSize: 100,
      fields: 'files(id, name)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });

    const markdownFiles = [];
    const convertedFiles = [];
    const zip = new AdmZip();

    for (const file of fileListResponse.data.files) {
      try {
        // Get the document content
        const docContent = await docs.documents.get({
          documentId: file.id
        });

        // Extract content
        const content = extractDocumentContent(docContent.data);

        // Basic markdown detection
        if (
            content.includes('# ') ||
            content.includes('## ') ||
            content.includes('**') ||
            content.includes('*') ||
            content.includes('- ') ||
            content.includes('```')
        ) {
          markdownFiles.push(file);

          // Convert markdown to HTML
          const htmlContent = marked.parse(content);

          // Create a new Google Docs file
          const docsFile = await docs.documents.create({
            resource: {
              title: `Converted-${file.name}`
            }
          });

          // Write HTML content to the document
          await docs.documents.batchUpdate({
            documentId: docsFile.data.documentId,
            resource: {
              requests: [{
                insertText: {
                  location: {
                    index: 1
                  },
                  text: htmlContent
                }
              }]
            }
          });

          // Move the file to converted folder
          await drive.files.update({
            fileId: docsFile.data.documentId,
            addParents: convertedFolderId,
            fields: 'id, parents',
            supportsAllDrives: true
          });

          // Export as PDF and add to zip
          const pdfContent = await drive.files.export({
            fileId: docsFile.data.documentId,
            mimeType: 'application/pdf'
          });

          // Ensure we're working with a buffer
          const pdfBuffer = Buffer.isBuffer(pdfContent.data)
              ? pdfContent.data
              : Buffer.from(pdfContent.data);

          zip.addFile(`${file.name}.pdf`, pdfBuffer);

          convertedFiles.push({
            originalFileName: file.name,
            convertedFileName: `${file.name}.pdf`,
            status: 'converted'
          });
        }
      } catch (fileError) {
        console.error(`Error processing file ${file.id}:`, fileError);
        convertedFiles.push({
          originalFileName: file.name,
          status: 'failed',
          error: fileError.message
        });
      }
    }

    // Generate zip file
    const zipBuffer = zip.toBuffer();

    res.json({
      totalFiles: markdownFiles.length,
      convertedFiles,
      zipDownloadLink: `/api/download-zip?token=${req.headers.authorization.split(' ')[1]}`
    });

    // Store zip temporarily (you might want to implement a more robust storage solution)
    global.convertedZip = zipBuffer;
  } catch (error) {
    console.error('Conversion error:', error);
    res.status(500).json({
      error: 'Conversion Failed',
      details: error.message
    });
  }
});

// Zip Download Route
app.get('/api/download-zip', authenticateGoogle, (req, res) => {
  if (global.convertedZip) {
    res.contentType('application/zip');
    res.header('Content-Disposition', 'attachment; filename=converted_markdown_files.zip');
    res.send(global.convertedZip);
  } else {
    res.status(404).json({ error: 'No zip file available' });
  }
});

const PORT = process.env.PORT || 3500;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});