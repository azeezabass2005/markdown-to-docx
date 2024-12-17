require('dotenv').config();
const { google } = require('googleapis');
const express = require('express');
const mammoth = require('mammoth');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3500;

const TOKEN_PATH = path.join(__dirname, 'tokens.json');

// Configure Google OAuth
const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URL
);

// Load stored tokens at startup
const loadTokens = async () => {
    try {
        const tokenData = await fs.readFile(TOKEN_PATH);
        const tokens = JSON.parse(tokenData);
        oauth2Client.setCredentials(tokens);
        console.log('Tokens loaded successfully.');
    } catch (error) {
        console.log('No tokens found, proceed to authorize.');
    }
};

// Save tokens to file
const saveTokens = async (tokens) => {
    await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens));
    console.log('Tokens saved successfully.');
};

// Middleware to refresh access token if expired
const ensureValidTokens = async (req, res, next) => {
    try {
        const { token } = await oauth2Client.getAccessToken();
        if (!token) throw new Error('Invalid access token');
        next();
    } catch (error) {
        console.error('Error refreshing token:', error.message);
        res.status(401).json({ error: 'Unauthorized: Token expired' });
    }
};

// OAuth routes
app.get('/auth/google', (req, res) => {
    const scopes = [
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/documents.readonly',
    ];
    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: scopes,
        prompt: 'consent' // Forces new refresh token
    });
    res.redirect(url);
});

app.get('/auth/google/callback', async (req, res) => {
    const { code } = req.query;
    try {
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);
        await saveTokens(tokens);

        console.log('Access Token:', tokens.access_token);
        console.log('Refresh Token:', tokens.refresh_token);

        res.status(200).json({ message: 'Authentication successful', tokens });
    } catch (error) {
        console.error('OAuth Callback Error:', error.message);
        res.status(500).json({ error: 'Authentication failed' });
    }
});

// Batch conversion endpoint
app.post('/convert-docs-batch', ensureValidTokens, async (req, res) => {
    try {
        const drive = google.drive({ version: 'v3', auth: oauth2Client });
        const docs = google.docs({ version: 'v1', auth: oauth2Client });

        // Query Google Drive for Markdown files
        const query = "mimeType='application/vnd.google-apps.document' and name contains '.md'";
        const fileListResponse = await drive.files.list({
            q: query,
            pageSize: 1000,
            fields: 'files(id, name)',
        });

        const markdownFiles = fileListResponse.data.files;
        const conversionResults = [];

        // Ensure converted directory exists
        await fs.mkdir('converted', { recursive: true });

        for (const file of markdownFiles) {
            try {
                // Fetch document content
                const docResponse = await docs.documents.get({ documentId: file.id });

                // Extract text content
                const content = extractTextFromDocs(docResponse.data.body.content);

                // Convert to HTML
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
            } catch (fileError) {
                console.error(`Error converting file ${file.name}:`, fileError.message);
                conversionResults.push({
                    originalFileName: file.name,
                    status: 'failed',
                    error: fileError.message
                });
            }
        }

        res.json({
            totalFiles: markdownFiles.length,
            successfulConversions: conversionResults.filter(r => r.status === 'success').length,
            results: conversionResults
        });
    } catch (error) {
        console.error('Batch Conversion Error:', error.message);
        res.status(500).json({ error: 'Batch conversion failed', details: error.message });
    }
});

// Helper functions
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

function convertMarkdownToHtml(markdownContent) {
    const marked = require('marked');
    return marked(markdownContent);
}

async function convertHtmlToDocx(htmlContent) {
    const { convertHtml } = require('mammoth');
    return new Promise((resolve, reject) => {
        convertHtml({ path: undefined, html: htmlContent })
            .then(result => resolve(result.buffer))
            .catch(reject);
    });
}

// Server startup
loadTokens().then(() => {
    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
});
