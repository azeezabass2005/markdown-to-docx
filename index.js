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
app.use(cors('*'));
app.use(express.json());

// OAuth Client Configuration
const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URL
);

// Enhanced markdown detection function with more lenient checks
function isMarkdownContent(content) {
  // Log content for debugging
  console.log('Checking content:', content.substring(0, 200) + '...'); // First 200 chars

  const markdownPatterns = {
    headers: /#\s.+/m,                          // Headers (more lenient)
    lists: /^[-*+]\s.+/m,                       // Unordered lists
    numberedLists: /^\d+\.\s.+/m,              // Numbered lists
    codeBlocks: /```[\s\S]*?```/,              // Code blocks
    inlineCode: /`[^`]+`/,                      // Inline code
    emphasis: /(\*\*|\*|__|_)/,                 // Bold/Italic (more lenient)
    links: /\[.+?\]\(.+?\)/,                    // Links (more lenient)
    blockquotes: /^>\s.+/m,                     // Blockquotes
    tables: /\|.+\|/,                           // Tables (more lenient)
    horizontalRules: /^[-*_]{3,}$/m            // Horizontal rules
  };

  // Log which patterns are found
  const matchedPatterns = Object.entries(markdownPatterns)
      .filter(([name, pattern]) => {
        const isMatch = pattern.test(content);
        console.log(`Pattern ${name}: ${isMatch ? 'found' : 'not found'}`);
        return isMatch;
      });

  // More lenient requirement: only need 2 patterns or specific important patterns
  const hasImportantPatterns = markdownPatterns.headers.test(content) ||
      markdownPatterns.lists.test(content) ||
      markdownPatterns.emphasis.test(content);

  return matchedPatterns.length >= 2 || hasImportantPatterns;
}

// Improved content extraction function
function extractDocumentContent(docContent) {
  try {
    if (!docContent.body || !docContent.body.content) {
      console.log('Document body or content is missing');
      return '';
    }

    const contentParts = [];

    const processElement = (element) => {
      if (element.paragraph && element.paragraph.elements) {
        element.paragraph.elements.forEach(el => {
          if (el.textRun && el.textRun.content) {
            contentParts.push(el.textRun.content);
          }
        });
      } else if (element.table) {
        element.table.tableRows.forEach(row => {
          row.tableCells.forEach(cell => {
            if (cell.content) {
              cell.content.forEach(cellElement => {
                processElement(cellElement);
              });
            }
          });
        });
      } else if (element.tableOfContents) {
        // Skip TOC elements
      } else {
        console.log('Unknown element type:', Object.keys(element));
      }
    };

    docContent.body.content.forEach(processElement);

    const fullContent = contentParts.join('\n');
    console.log('Extracted content length:', fullContent.length);
    return fullContent;
  } catch (error) {
    console.error('Content extraction error:', error);
    return '';
  }
}
function htmlToGoogleDocsStructure(htmlContent) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlContent, 'text/html');

  const requests = [];
  let currentIndex = 1;

  function addRequest(request) {
    requests.push(request);
  }

  function addText(text, style = {}) {
    if (!text.trim()) return;

    addRequest({
      insertText: {
        location: { index: currentIndex },
        text: text + '\n'
      }
    });

    if (Object.keys(style).length > 0) {
      addRequest({
        updateParagraphStyle: {
          range: {
            startIndex: currentIndex,
            endIndex: currentIndex + text.length
          },
          paragraphStyle: style,
          fields: '*'
        }
      });
    }

    currentIndex += text.length + 1;
  }

  // Process elements
  function processElement(element) {
    switch (element.tagName) {
      case 'H1':
        addText(element.textContent, {
          namedStyleType: 'HEADING_1',
          spaceAbove: { magnitude: 20, unit: 'PT' },
          spaceBelow: { magnitude: 10, unit: 'PT' }
        });
        break;

      case 'H2':
        addText(element.textContent, {
          namedStyleType: 'HEADING_2',
          spaceAbove: { magnitude: 16, unit: 'PT' },
          spaceBelow: { magnitude: 8, unit: 'PT' }
        });
        break;

      case 'P':
        addText(element.textContent, {
          namedStyleType: 'NORMAL_TEXT',
          spaceAbove: { magnitude: 8, unit: 'PT' },
          spaceBelow: { magnitude: 8, unit: 'PT' }
        });
        break;

      case 'PRE':
        addText(element.textContent, {
          namedStyleType: 'NORMAL_TEXT',
          backgroundColor: { color: { rgbColor: { red: 0.95, green: 0.95, blue: 0.95 } } },
          spaceAbove: { magnitude: 12, unit: 'PT' },
          spaceBelow: { magnitude: 12, unit: 'PT' }
        });
        break;

      case 'UL':
      case 'OL':
        Array.from(element.children).forEach((li, index) => {
          const prefix = element.tagName === 'UL' ? '• ' : `${index + 1}. `;
          addText(prefix + li.textContent, {
            namedStyleType: 'NORMAL_TEXT',
            indentStart: { magnitude: 36, unit: 'PT' },
            spaceAbove: { magnitude: 4, unit: 'PT' },
            spaceBelow: { magnitude: 4, unit: 'PT' }
          });
        });
        break;

      case 'BLOCKQUOTE':
        addText(element.textContent, {
          namedStyleType: 'NORMAL_TEXT',
          indentStart: { magnitude: 48, unit: 'PT' },
          spaceAbove: { magnitude: 12, unit: 'PT' },
          spaceBelow: { magnitude: 12, unit: 'PT' },
          borderLeft: {
            color: { color: { rgbColor: { red: 0.8, green: 0.8, blue: 0.8 } } },
            width: { magnitude: 3, unit: 'PT' },
            padding: { magnitude: 12, unit: 'PT' }
          }
        });
        break;
    }
  }
  // Process all elements
  function walkDOM(node) {
    if (node.nodeType === 1) { // Element node
      processElement(node);
    }
    node.childNodes.forEach(child => {
      if (child.nodeType === 1 && !['SCRIPT', 'STYLE'].includes(child.tagName)) {
        walkDOM(child);
      }
    });
  }

  walkDOM(doc.body);
  return requests;
}


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

  console.log(code, "This is the code gotten on the backend")

  if (!code) {
    return res.status(400).json({
      message: 'No authorization code provided'
    });
  }

  try {
    // Exchange authorization code for tokens
    const { tokens } = await oauth2Client.getToken(code);

    console.log(tokens, "This is the tokens from google auth")

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
    console.log('Starting /api/docs endpoint');
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const docs = google.docs({ version: 'v1', auth: oauth2Client });

    const response = await drive.files.list({
      q: "mimeType='application/vnd.google-apps.document'",
      fields: 'files(id, name, permissions)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });

    console.log(`Found ${response.data.files.length} total documents`);
    const markdownDocs = [];

    for (const file of response.data.files) {
      try {
        console.log(`Processing file: ${file.name} (${file.id})`);
        const docContent = await docs.documents.get({
          documentId: file.id
        });

        const content = extractDocumentContent(docContent.data);
        console.log(`Extracted content length for ${file.name}: ${content.length}`);

        if (isMarkdownContent(content)) {
          console.log(`${file.name} identified as markdown`);
          markdownDocs.push({
            ...file,
            previewContent: content.substring(0, 200) // Add preview content for verification
          });
        } else {
          console.log(`${file.name} is not markdown`);
        }
      } catch (error) {
        console.error(`Error processing doc ${file.id}:`, error);
      }
    }

    console.log(`Found ${markdownDocs.length} markdown documents`);
    res.json(markdownDocs);
  } catch (error) {
    console.error('Full error details:', error);
    res.status(500).json({
      error: 'Error processing documents',
      details: error.message
    });
  }
});
// Conversion Utilities

// Update your conversion endpoint to use the new functions
app.post('/api/convert', authenticateGoogle, async (req, res) => {
  try {
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const docs = google.docs({ version: 'v1', auth: oauth2Client });

    const convertedFolderId = await createConvertedFolder(drive);

    const fileListResponse = await drive.files.list({
      q: "mimeType='application/vnd.google-apps.document'",
      pageSize: 100,
      fields: 'files(id, name)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });

    const convertedFiles = [];
    const zip = new AdmZip();

    for (const file of fileListResponse.data.files) {
      try {
        const docContent = await docs.documents.get({
          documentId: file.id
        });

        const content = extractDocumentContent(docContent.data);

        // Only process markdown files
        if (isMarkdownContent(content)) {
          const htmlContent = marked.parse(content);
          const requests = htmlToGoogleDocsStructure(htmlContent);

          const docsFile = await docs.documents.create({
            resource: {
              title: `Converted-${file.name}`
            }
          });

          await docs.documents.batchUpdate({
            documentId: docsFile.data.documentId,
            resource: { requests }
          });

          await drive.files.update({
            fileId: docsFile.data.documentId,
            addParents: convertedFolderId,
            fields: 'id, parents',
            supportsAllDrives: true
          });

          const pdfResponse = await drive.files.export(
              {
                fileId: docsFile.data.documentId,
                mimeType: 'application/pdf'
              },
              { responseType: 'arraybuffer' }
          );

          const pdfBuffer = Buffer.from(pdfResponse.data);
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

    const zipBuffer = zip.toBuffer();

    res.json({
      totalFiles: convertedFiles.length,
      convertedFiles,
      zipDownloadLink: `/api/download-zip?token=${req.headers.authorization.split(' ')[1]}`
    });

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
app.post('/api/convert-3', authenticateGoogle, async (req, res) => {
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