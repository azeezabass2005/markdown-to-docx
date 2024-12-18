const showdown = require('showdown');
const mammoth = require('mammoth');
const fs = require('fs').promises;
const path = require('path');

async function convertMarkdownToDOCX(markdownContent) {
  // Convert markdown to HTML
  const converter = new showdown.Converter();
  const htmlContent = converter.makeHtml(markdownContent);

  // Convert HTML to DOCX using mammoth
  const result = await mammoth.convertToBuffer(
    { path: htmlContent },
    { convertImage: mammoth.images.inline(async (element) => {
      // Handle image conversion if needed
      return element;
    })}
  );

  return result.buffer;
}

module.exports = { convertMarkdownToDOCX };