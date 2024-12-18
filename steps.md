# Environment Variables Setup Guide

## Required Environment Variables

### 1. Google OAuth Credentials
```plaintext
GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here
GOOGLE_REDIRECT_URL=https://markdown-to-docx.onrender.com/auth/google/callback
```

### 2. Authentication Flow
- Initially, these will be empty
- After first authentication, you'll get:
```plaintext
GOOGLE_ACCESS_TOKEN=generated_access_token
GOOGLE_REFRESH_TOKEN=generated_refresh_token
```

### 3. Server Configuration
```plaintext
PORT=3500
NODE_ENV=production
```

## Obtaining Credentials Step-by-Step

### Local Development (.env file)
1. Create a `.env` file in project root
2. Add the credentials from Google Cloud Console
3. Install dotenv:
```bash
npm install dotenv
```
4. In your main file, add:
```javascript
require('dotenv').config();
```

### Render Deployment
1. Go to Render Dashboard
2. Select your project/service
3. Go to "Environment" section
4. Add each variable:
   - GOOGLE_CLIENT_ID
   - GOOGLE_CLIENT_SECRET
   - GOOGLE_REDIRECT_URL
   - PORT (usually 3500)
   - NODE_ENV (production)

## Authentication Flow
1. First-time Setup:
   - Visit `https://markdown-to-docx.onrender.com/auth/google`
   - Google consent screen appears
   - Approve access
   - Redirected back with authorization code
   - Server exchanges code for tokens
   - Tokens stored in environment vari

   // authorize url --> account.google.com/o/oauth2/v2/auth
// token url --> https://oauth2.googleapis.com/token