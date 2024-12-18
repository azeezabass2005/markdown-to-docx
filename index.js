const { google } = require('googleapis');
const express = require('express');
const mammoth = require('mammoth');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3500;

// Configure Google OAuth
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URL
);

// Batch conversion endpoint
app.post('/convert-docs-batch', async (req, res) => {
  try {
    // Validate access token
    oauth2Client.setCredentials({
      access_token: process.env.GOOGLE_ACCESS_TOKEN,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN
    });

    // Initialize Google Drive API
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const docs = google.docs({ version: 'v1', auth: oauth2Client });

    // Query to find Markdown files in Google Docs
    const query = "mimeType='application/vnd.google-apps.document' and name contains '.md'";
    const fileListResponse = await drive.files.list({
      q: query,
      pageSize: 1000,  // Adjust based on your total file count
      fields: 'files(id, name)'
    });

    const markdownFiles = fileListResponse.data.files;
    const conversionResults = [];

    // Ensure converted directory exists
    await fs.mkdir('converted', { recursive: true });

    // Batch conversion process
    for (const file of markdownFiles) {
      try {
        // Fetch document content
        const docResponse = await docs.documents.get({ 
          documentId: file.id 
        });

        // Extract text content
        const content = extractTextFromDocs(docResponse.data.body.content);

        // Convert to HTML (assuming content is Markdown)
        const htmlContent = convertMarkdownToHtml(content);

        // Convert to DOCX
        const buffer = await convertHtmlToDocx(htmlContent);

        // Save DOCX file
        const outputFilename = `${file.name.replace('.md', '')}.docx`;
        const outputPath = path.join('converted', outputFilename);
        await fs.writeFile(outputPath, buffer);

        conversionResults.push({
          originalFileName: file.name,
          convertedFileName: outputFilename,
          status: 'success'
        });
      } catch (fileConversionError) {
        conversionResults.push({
          originalFileName: file.name,
          status: 'failed',
          error: fileConversionError.message
        });
      }
    }

    // Respond with conversion results
    res.json({
      totalFiles: markdownFiles.length,
      successfulConversions: conversionResults.filter(r => r.status === 'success').length,
      results: conversionResults
    });

  } catch (error) {
    console.error('Batch Conversion Error:', error);
    res.status(500).json({ 
      error: 'Batch conversion failed', 
      details: error.message 
    });
  }
});

// Helper function to extract text from Google Docs
function extractTextFromDocs(content) {
  let textContent = '';
  content.forEach(element => {
    if (element.paragraph) {
      element.paragraph.elements.forEach(el => {
        if (el.textRun) {
          textContent += el.textRun.content;
        }
      });
      textContent += '\n';
    }
  });
  return textContent;
}

// Helper function to convert Markdown to HTML
function convertMarkdownToHtml(markdownContent) {
  const marked = require('marked');
  return marked(markdownContent);
}

// Helper function to convert HTML to DOCX
async function convertHtmlToDocx(htmlContent) {
  const { convertHtml } = require('mammoth');
  
  return new Promise((resolve, reject) => {
    convertHtml({ 
      path: undefined, 
      html: htmlContent 
    })
    .then(result => resolve(result.buffer))
    .catch(reject);
  });
}

// OAuth routes (for initial setup)
app.get('/auth/google', (req, res) => {
  const scopes = [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/documents.readonly'
  ];
  
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes
  });

  res.redirect(url);
});

// OAuth callback handler
app.get('/auth/google/callback', async (req, res) => {
  const { code } = req.query;
  
  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    
    // IMPORTANT: Securely store these tokens
    process.env.GOOGLE_ACCESS_TOKEN = tokens.access_token;
    process.env.GOOGLE_REFRESH_TOKEN = tokens.refresh_token;

    console.log(tokens.access_token, "This is the access token")
    console.log(tokens.refresh_token, "this is the refresh token")

    res.send('Authentication successful! You can now use the batch conversion service.');
  } catch (error) {
    res.status(500).send('Authentication failed');
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});