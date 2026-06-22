# World Cup 2026 Bracket Predictor

A simple bracket prediction game for the FIFA World Cup 2026 knockout stage.

> **Editing & pushing changes?** See [DEVELOPING.md](DEVELOPING.md) for the
> edit → preview → push workflow.

## Features

- Pick quarterfinalists, semifinalists, finalists, and champion
- Cascading dropdowns (semifinalists only show teams you picked for QF, etc.)
- Live leaderboard with automatic scoring
- Admin panel to enter actual results
- Mobile-friendly

## Setup

### 1. Create a Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Create a project"
3. Name it (e.g., "wc2026-bracket")
4. Disable Google Analytics (optional)
5. Click "Create project"

### 2. Create Firestore Database

1. In your Firebase project, go to **Build > Firestore Database**
2. Click "Create database"
3. Choose "Start in test mode" (for simplicity)
4. Select a location close to your users
5. Click "Enable"

### 3. Get Your Firebase Config

1. Go to **Project Settings** (gear icon)
2. Scroll down to "Your apps"
3. Click the web icon (`</>`) to add a web app
4. Name it (e.g., "bracket-web")
5. Copy the `firebaseConfig` object

### 4. Update config.js

Edit `config.js` and paste your Firebase config:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

### 5. Deploy to GitHub Pages

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/bracket-predictor.git
git push -u origin main
```

Then in GitHub:
1. Go to repo **Settings > Pages**
2. Source: Deploy from branch
3. Branch: main / root
4. Save

Your site will be live at: `https://YOUR_USERNAME.github.io/bracket-predictor/`

## Scoring

| Round | Points per correct pick |
|-------|------------------------|
| Quarterfinalists | 2 pts |
| Semifinalists | 4 pts |
| Finalists | 8 pts |
| Champion | 16 pts |

**Maximum possible score: 64 points**

## Usage

### For Participants
1. Go to the Submit Picks page
2. Enter name and email
3. Pick 8 quarterfinalists
4. Pick 4 semifinalists (from your QF picks)
5. Pick 2 finalists (from your SF picks)
6. Pick the champion (from your finalists)
7. Click Submit

### For Admin
1. Go to the Admin page
2. As the tournament progresses, enter actual results
3. Click "Save Results"
4. The leaderboard will automatically update everyone's scores

## Security Note

The admin page is currently open. For production use, consider:
- Adding Firebase Authentication
- Setting up Firestore security rules
- Password-protecting the admin page

## License

MIT
