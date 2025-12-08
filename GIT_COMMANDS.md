# Git Bash Commands - Quick Reference
# Copy and paste these commands in order

# ========================================
# INITIAL SETUP (Run once)
# ========================================

# 1. Create and navigate to project folder
mkdir ~/robpac-resources
cd ~/robpac-resources

# 2. Verify location
pwd

# 3. Initialize Git
git init

# 4. Stage all files
git add .

# 5. First commit
git commit -m "Initial commit: RobPac Resources landing page"

# 6. Add remote (REPLACE YOUR-USERNAME with your GitHub username!)
git remote add origin https://github.com/YOUR-USERNAME/robpac-resources.git

# 7. Verify remote
git remote -v

# 8. Push to GitHub
git branch -M main
git push -u origin main

# ========================================
# DAILY WORKFLOW (After making changes)
# ========================================

# Navigate to project
cd ~/robpac-resources

# Check what changed
git status

# See detailed changes
git diff

# Stage all changes
git add .

# Or stage specific file
git add index.html

# Commit with message
git commit -m "Update: your description here"

# Push to GitHub (triggers Vercel auto-deploy)
git push

# ========================================
# USEFUL COMMANDS
# ========================================

# View commit history
git log --oneline

# View last 5 commits
git log --oneline -5

# Undo last commit (keeps changes)
git reset --soft HEAD~1

# Discard all local changes (DANGER!)
git reset --hard HEAD

# Pull latest from GitHub
git pull origin main

# See all branches
git branch -a

# Create new branch
git checkout -b feature/new-design

# Switch back to main
git checkout main

# Merge branch into main
git merge feature/new-design

# ========================================
# FIXING COMMON ISSUES
# ========================================

# If push rejected
git pull origin main --rebase
git push

# If you need to force push (CAREFUL!)
git push --force

# If you want to start fresh
git fetch origin
git reset --hard origin/main

# Remove file from Git but keep locally
git rm --cached filename.txt

# Change last commit message
git commit --amend -m "New message"

# ========================================
# VERCEL DEPLOYMENT
# ========================================

# Install Vercel CLI (run once)
npm install -g vercel

# Login to Vercel
vercel login

# Deploy to preview
vercel

# Deploy to production
vercel --prod

# Check deployment status
vercel ls

# ========================================
# CONFIGURATION
# ========================================

# Set your name (run once per computer)
git config --global user.name "Your Name"

# Set your email (run once per computer)
git config --global user.email "your.email@example.com"

# View all config
git config --list

# Set default editor (optional)
git config --global core.editor "code"

# ========================================
# QUICK DEPLOY WORKFLOW
# ========================================

# One-liner for quick updates
git add . && git commit -m "Quick update" && git push

# ========================================
# FILE MANAGEMENT
# ========================================

# Add new file
git add newfile.html
git commit -m "Add new file"
git push

# Delete file
git rm oldfile.html
git commit -m "Remove old file"
git push

# Rename file
git mv oldname.html newname.html
git commit -m "Rename file"
git push

# ========================================
# GITHUB COMMANDS (if using GitHub CLI)
# ========================================

# Create repo and push in one command
gh repo create robpac-resources --public --source=. --remote=origin --push

# View repo in browser
gh repo view --web

# Create issue
gh issue create --title "Bug report" --body "Description"

# ========================================
# TROUBLESHOOTING
# ========================================

# Check Git version
git --version

# Test SSH connection to GitHub
ssh -T git@github.com

# Clear Git cache
git rm -r --cached .
git add .
git commit -m "Clear cache"

# Reset to specific commit
git reset --hard COMMIT_HASH

# Show file at specific commit
git show COMMIT_HASH:filename.html

# ========================================
# BACKUP COMMANDS
# ========================================

# Create backup branch
git checkout -b backup-$(date +%Y%m%d)
git push origin backup-$(date +%Y%m%d)

# Return to main
git checkout main

# ========================================
# NOTES
# ========================================

# - Always commit with descriptive messages
# - Pull before push if working from multiple computers
# - Use branches for experimental features
# - Main branch should always be deployable
# - Vercel auto-deploys on every push to main

# ========================================
# SHORTCUT ALIASES (Optional Setup)
# ========================================

# Add these to ~/.bashrc or ~/.bash_profile for shortcuts

# git status
alias gs='git status'

# git add all
alias ga='git add .'

# git commit
alias gc='git commit -m'

# git push
alias gp='git push'

# git pull
alias gl='git pull'

# quick commit and push
alias gcp='git add . && git commit -m "Quick update" && git push'

# After adding aliases, reload:
source ~/.bashrc
