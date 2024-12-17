const express = require('express');
const { google } = require('googleapis');
const axios = require('axios');
const mammoth = require('mammoth');
const { marked } = require('marked');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// Google Docs and Authentication Configuration
const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URL
);

// Configure Make.com webhook endpoint
app.use(express.json());

app.post('/convert-markdown', async (req, res) => {
    try {
        // Assuming Make.com sends the Google Docs file ID
        const { fileId } = req.body;

        // Authenticate with Google
        oauth2Client.setCredentials({
            access_token: process.env.GOOGLE_ACCESS_TOKEN
        });

        const docs = google.docs({ version: 'v1', auth: oauth2Client });

        // Fetch document content
        const response = await docs.documents.get({ documentId: fileId });
        const content = response.data.body.content;

        // Extract text from Google Docs
        let markdownContent = extractTextFromDocs(content);

        // Convert Markdown to HTML
        const htmlContent = marked(markdownContent);

        // Convert HTML to DOCX
        const buffer = await convertHtmlToDocx(htmlContent);

        // Save the DOCX file
        const outputPath = path.join(__dirname, 'converted', `${fileId}.docx`);
        await fs.writeFile(outputPath, buffer);

        // Send response to Make.com
        res.json({
            success: true,
            outputPath: outputPath
        });
    } catch (error) {
        console.error('Conversion Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
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

// Authentication route for Google OAuth
app.get('/auth/google', (req, res) => {
    const scopes = ['https://www.googleapis.com/auth/documents.readonly'];

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

        // Store tokens securely (e.g., in environment variables or a secure database)
        process.env.GOOGLE_ACCESS_TOKEN = tokens.access_token;
        process.env.GOOGLE_REFRESH_TOKEN = tokens.refresh_token;

        res.send('Authentication successful! You can now use the conversion service.');
    } catch (error) {
        res.status(500).send('Authentication failed');
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});