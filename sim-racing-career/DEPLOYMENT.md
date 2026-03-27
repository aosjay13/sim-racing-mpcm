# Deployment Guide

This guide covers deploying your Sim Racing Career application to various platforms.

## Overview of Deployment Options

| Platform | Difficulty | Cost | Embedding |
|----------|-----------|------|-----------|
| GitHub Pages | Easy | Free | ✅ Easy |
| Firebase Hosting | Easy | Free tier | ✅ Easy |
| Netlify | Easy | Free tier | ✅ Easy |
| Google Sites Embed | Very Easy | Free* | ✅ Direct |
| AWS S3 | Medium | Paid | ✅ Yes |
| Custom VPS | Hard | $$/month | ✅ Yes |

*Requires Firebase or other backend for database

## Option 1: Firebase Hosting (RECOMMENDED)

### Benefits
- ✅ Free tier generous
- ✅ Easy to deploy
- ✅ HTTPS included
- ✅ Works perfectly with Firestore
- ✅ Good performance

### Steps

1. **Install Firebase CLI**
   ```bash
   npm install -g firebase-tools
   ```

2. **Login to Firebase**
   ```bash
   firebase login
   ```

3. **Initialize Firebase Hosting**
   ```bash
   cd sim-racing-career
   firebase init hosting
   ```
   
   When prompted:
   - Select your Firebase project
   - Public directory: `.`
   - Single page app: `Yes`
   - Setup automatic builds: `No`

4. **Update firebase.json**
   ```json
   {
     "hosting": {
       "public": ".",
       "ignore": [
         "firebase.json",
         "**/.*",
         "**/node_modules/**"
       ],
       "cleanUrls": true,
       "rewrites": [
         {
           "source": "**",
           "destination": "/index.html"
         }
       ]
     }
   }
   ```

5. **Deploy**
   ```bash
   firebase deploy --only hosting
   ```

6. **Your app is live at**
   ```
   https://YOUR_PROJECT_ID.web.app
   https://YOUR_PROJECT_ID.firebaseapp.com
   ```

## Option 2: GitHub Pages

### Benefits
- ✅ Free
- ✅ Version control included
- ✅ CI/CD integration
- ✅ Custom domain support

### Steps

1. **Create GitHub Repository**
   ```bash
   git init
   git add .
   git commit -m "Initial commit: Sim Racing Career"
   ```

2. **Push to GitHub**
   ```bash
   git branch -M main
   git remote add origin https://github.com/yourusername/sim-racing-career.git
   git push -u origin main
   ```

3. **Enable GitHub Pages**
   - Go to repository settings
   - Scroll to "GitHub Pages"
   - Select: Source = "main" branch
   - Folder = "root (/)"
   - Click "Save"

4. **Your site is live at**
   ```
   https://yourusername.github.io/sim-racing-career/
   ```

5. **Custom Domain (Optional)**
   - Update DNS records to point to GitHub Pages
   - Add CNAME file to repo with your domain

## Option 3: Netlify

### Benefits
- ✅ Very easy deployment
- ✅ Free tier
- ✅ Preview URLs for branches
- ✅ Form handling included

### Steps

1. **Connect to Netlify**
   - Go to [netlify.com](https://netlify.com)
   - Click "New site from Git"
   - Connect your GitHub repository

2. **Configure Build**
   - Build command: (leave empty)
   - Publish directory: `.`

3. **Deploy**
   - Netlify auto-deploys on every push
   - Your site is live immediately

## Option 4: Direct Google Sites Embed

### Easiest Deployment (No hosting needed for frontend)

Uses Firebase Hosting for the app, embeds in Google Sites:

1. **Deploy to Firebase Hosting** (see Option 1)

2. **In Google Sites**
   - Click "+ Insert"
   - Select "Embed code"
   - Paste:
   ```html
   <iframe 
     src="https://YOUR_PROJECT_ID.web.app/" 
     width="100%" 
     height="900" 
     style="border: none;">
   </iframe>
   ```

3. **Add as Page Gadget (Alternative)**
   - Go to insert gadget
   - Select "Web page"
   - Enter URL: `https://YOUR_PROJECT_ID.web.app/`

## Option 5: AWS S3 + CloudFront

### For advanced users with AWS accounts

### Steps

1. **Create S3 Bucket**
   ```bash
   aws s3 mb s3://your-sim-racing-app --region us-east-1
   ```

2. **Enable Static Website Hosting**
   ```bash
   aws s3 website s3://your-sim-racing-app \
     --index-document index.html \
     --error-document index.html
   ```

3. **Upload Files**
   ```bash
   aws s3 sync . s3://your-sim-racing-app/
   ```

4. **Create CloudFront Distribution**
   - AWS Console > CloudFront
   - Create distribution
   - Origin: S3 bucket
   - Viewer protocol: HTTPS only

## Local & Development Servers

### Python (Built-in)
```bash
# Python 3
python -m http.server 8000

# Python 2
python -m SimpleHTTPServer 8000
```

### Node.js
```bash
npx http-server
# or
npx serve
```

### Live Server (VSCode Extension)
- Install extension: Live Server
- Right-click index.html → "Open with Live Server"

## Continuous Deployment

### Firebase with GitHub Actions

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Firebase

on:
  push:
    branches: [ main ]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '16'
      
      - name: Deploy to Firebase
        uses: w9jds/firebase-action@master
        with:
          args: deploy --only hosting
        env:
          FIREBASE_TOKEN: ${{ secrets.FIREBASE_TOKEN }}
```

Get Firebase token:
```bash
firebase login:ci
```

## Domain Management

### Custom Domain with Firebase

1. Go to Hosting in Firebase Console
2. Click "Add custom domain"
3. Verify ownership
4. Update DNS records:
   - Option A: Use Firebase (easiest)
   - Option B: Use your registrar (more control)

### Domain Registrars
- Namecheap
- GoDaddy
- Google Domains
- Cloudflare

## Performance Optimization

### Before Deployment

1. **Minify CSS/JS** (Optional for production)
   ```bash
   npm install -g minify
   minify css/style.css > css/style.min.css
   minify js/app.js > js/app.min.js
   ```

2. **Update index.html to use minified versions**

3. **Enable Preloading**
   ```html
   <link rel="preload" href="css/style.css" as="style">
   <link rel="preload" href="js/app.js" as="script">
   ```

4. **Add Service Worker for offline support** (Advanced)

### After Deployment

- Monitor Firebase Console for quota usage
- Check Google PageSpeed Insights
- Review browser console for errors

## Monitoring & Analytics

### Firebase Console Monitoring
- Firestore usage
- Hosting traffic
- Error logs

### Google Analytics (Add to index.html)

```html
<!-- Google Analytics -->
<script async src="https://www.googletagmanager.com/gtag/js?id=GA_ID"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'GA_ID');
</script>
```

## SSL/HTTPS

All recommended platforms provide HTTPS by default:
- Firebase Hosting: ✅ Automatic
- GitHub Pages: ✅ Automatic
- Netlify: ✅ Automatic
- AWS CloudFront: ✅ Optional

## Environment Variables

### For Client-Side Apps

Store in **public file** (not secrets!):
```javascript
// config/environment.js
const env = {
  firebaseApiKey: "YOUR_PUBLIC_API_KEY",
  databaseUrl: "YOUR_DATABASE_URL"
};
```

### For Server-Side (Node)

Use `.env` file:
```
FIREBASE_API_KEY=xxx
FIREBASE_PROJECT_ID=xxx
```

Load with:
```javascript
require('dotenv').config();
const apiKey = process.env.FIREBASE_API_KEY;
```

## Rollback & Version Control

### Firebase Hosting Rollback
```bash
firebase hosting:channels:list
firebase hosting:rollback
```

### GitHub Version Control
```bash
# View history
git log

# Revert to previous version
git revert <commit-hash>
git push
```

## Troubleshooting Deployment

### App shows blank page
- Check browser console for JavaScript errors
- Verify Firebase config is correct
- Check that all assets load (Network tab)

### 404 errors on refresh
- Add rewrite rule in hosting config:
```json
"rewrites": [
  {
    "source": "**",
    "destination": "/index.html"
  }
]
```

### CORS errors
- Most platforms handle this, but check:
  - Firebase: Check Hosting settings
  - S3: Configure CORS policy

### Firebase not connecting
- Verify Firebase config in code
- Check Firestore security rules
- Verify Firebase quota not exceeded

## Post-Deployment Checklist

- ✅ App loads on custom URL
- ✅ All features work (test in privacy mode)
- ✅ Mobile responsive
- ✅ Load sample data works
- ✅ Can add drivers/teams/races
- ✅ Data persists after page refresh
- ✅ No console errors
- ✅ Google Sites embed works (if applicable)
- ✅ HTTPS enabled
- ✅ Performance acceptable

## Maintenance

### Regular Tasks
- Monitor Firebase quotas
- Review error logs
- Update dependencies
- Backup data regularly
- Test all features monthly

### Scaling
When approaching quota limits:
1. Upgrade Firebase plan
2. Implement caching
3. Optimize queries
4. Archive old data

---

**Choose your deployment method and get your app live!**

Questions? Check the README.md or Firebase documentation.
