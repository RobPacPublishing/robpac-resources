# RobPac Resources - Landing Page

Premium digital resources landing page for entrepreneurs.

## 🚀 Quick Start

### Prerequisites
- Git Bash installed
- GitHub account
- Vercel account (free tier)

---

## 📁 Setup Instructions

### Step 1: Create Project Folder (Git Bash)

```bash
# Navigate to your projects directory (adjust path as needed)
cd ~

# Create project folder
mkdir robpac-resources

# Navigate into folder
cd robpac-resources

# Verify you're in the right place
pwd
```

**Output should show:** `/c/Users/YourUsername/robpac-resources` (or similar)

---

### Step 2: Add Files

1. Copy `index.html` to the `robpac-resources` folder
2. Copy `logo.png` to the same folder (make sure it's named exactly `logo.png`)

**File structure should be:**
```
robpac-resources/
├── index.html
├── logo.png
└── README.md (this file)
```

---

### Step 3: Initialize Git Repository

```bash
# Make sure you're in the robpac-resources folder
cd ~/robpac-resources

# Initialize Git
git init

# Check status (should show untracked files)
git status

# Stage all files
git add .

# Commit
git commit -m "Initial commit: RobPac Resources landing page"

# Verify commit
git log --oneline
```

---

### Step 4: Create GitHub Repository

**Option A: Via GitHub Website (Easier)**

1. Go to https://github.com
2. Click "+" in top-right → "New repository"
3. Repository name: `robpac-resources`
4. Description: "Landing page for RobPac Resources"
5. **Keep it PUBLIC** (required for free Vercel)
6. **DO NOT** initialize with README (we already have files)
7. Click "Create repository"

**Option B: Via GitHub CLI (if installed)**

```bash
gh repo create robpac-resources --public --source=. --remote=origin --push
```

---

### Step 5: Connect Local to GitHub

After creating the repo on GitHub, you'll see instructions. Use these commands:

```bash
# Add remote origin (replace YOUR-USERNAME with your GitHub username)
git remote add origin https://github.com/YOUR-USERNAME/robpac-resources.git

# Verify remote
git remote -v

# Push to GitHub
git branch -M main
git push -u origin main
```

**Verify:** Go to your GitHub repo URL - you should see the files there.

---

### Step 6: Deploy to Vercel

**Method A: Via Vercel Dashboard (Recommended)**

1. Go to https://vercel.com
2. Click "Add New..." → "Project"
3. Under "Import Git Repository":
   - Click "Import" next to your `robpac-resources` repo
   - If you don't see it, click "Adjust GitHub App Permissions"
4. Configure Project:
   - **Framework Preset:** Other
   - **Root Directory:** `./` (leave default)
   - **Build Command:** (leave empty)
   - **Output Directory:** (leave empty)
   - **Install Command:** (leave empty)
5. Click "Deploy"
6. Wait 30-60 seconds
7. ✅ Your site is live!

**Method B: Via Vercel CLI**

```bash
# Install Vercel CLI (if not installed)
npm install -g vercel

# Login
vercel login

# Deploy
vercel

# Follow the prompts:
# - Set up and deploy? Yes
# - Which scope? (select your account)
# - Link to existing project? No
# - What's your project's name? robpac-resources
# - In which directory is your code located? ./
# - Want to override settings? No

# Deploy to production
vercel --prod
```

---

### Step 7: Add Custom Domain

**In Vercel Dashboard:**

1. Go to your project → Settings → Domains
2. Enter: `resources.robpacpublishing.com`
3. Click "Add"
4. Vercel will show DNS instructions

**Configure DNS (where you manage robpacpublishing.com):**

Add a CNAME record:
```
Type: CNAME
Name: resources
Value: cname.vercel-dns.com
TTL: 300 (or Auto)
```

**Wait 5-30 minutes for DNS propagation**

**Verify:** Visit https://resources.robpacpublishing.com

---

## 🔄 Making Updates

### Update Content

```bash
# Edit index.html (in your text editor)

# Check changes
git status
git diff

# Stage changes
git add index.html

# Commit
git commit -m "Update: [describe what you changed]"

# Push to GitHub
git push

# Vercel auto-deploys within 30 seconds!
```

### Update Logo

```bash
# Replace logo.png file

# Stage and commit
git add logo.png
git commit -m "Update logo"
git push
```

---

## 📝 Next Steps - Before Going Live

### 1. Replace Placeholder Content

**Products:** Replace the 12 placeholder products with real products from Entrepedia
- Update titles, descriptions, prices
- Replace emoji placeholders with actual product images

**Payhip Integration:**
- Replace "Add to Cart" buttons with actual Payhip embed codes
- Get embed codes from Payhip dashboard for each product

### 2. Update Bundle Details

Edit the Featured Bundle section with real bundle information:
- Update product list
- Update pricing
- Add real Payhip button

### 3. Customize Content

Optional edits:
- Update testimonials with real customer feedback
- Adjust FAQ answers based on your policies
- Update footer links

### 4. Add Analytics

Add to `<head>` section before `</head>`:

```html
<!-- Google Analytics -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-XXXXXXXXXX');
</script>
```

---

## 🎨 Customization Guide

### Colors

Main color scheme is defined in Tailwind classes:
- Primary: `blue-600` (#2563eb) - CTA buttons, links
- Success: `green-600` - checkmarks, success states
- Discount: `red-600` - sale badges
- Gray: `gray-50/100/600/900` - backgrounds, text

To change:
1. Find and replace color classes in `index.html`
2. Example: Replace `bg-blue-600` with `bg-purple-600`

### Typography

Current font: **Inter** (clean, modern)

To change font:
1. Replace Google Fonts link in `<head>`
2. Update `font-family` in CSS

### Pricing

To update prices globally:
1. Search for price values (e.g., `$27`, `$37`)
2. Replace with new prices
3. Update "SAVE" calculations

---

## 🐛 Troubleshooting

### Issue: Git push rejected

```bash
# Pull latest changes first
git pull origin main --rebase

# Then push
git push
```

### Issue: Logo not showing

- Verify `logo.png` is in root folder
- Check filename is exactly `logo.png` (case-sensitive)
- Hard refresh browser: Ctrl+F5 (Windows) or Cmd+Shift+R (Mac)

### Issue: Vercel not auto-deploying

- Check GitHub webhook in repo Settings → Webhooks
- Manually trigger: Vercel Dashboard → Deployments → Redeploy

### Issue: Custom domain not working

- Verify CNAME record in DNS settings
- Wait 30 minutes for DNS propagation
- Check DNS with: https://dnschecker.org

---

## 📊 Performance Tips

Current page is already optimized:
- ✅ Single HTML file (fast load)
- ✅ Tailwind CSS via CDN (cached)
- ✅ No external dependencies
- ✅ Responsive images placeholder

**After adding real product images:**
- Compress images to <100KB each
- Use WebP format for better compression
- Consider lazy loading for images below fold

---

## 🔐 Security Notes

- No sensitive data in code (all client-side)
- Payments handled by Payhip (PCI compliant)
- HTTPS automatic via Vercel
- No database = no database vulnerabilities

---

## 📞 Support

**GitHub Issues:** https://github.com/YOUR-USERNAME/robpac-resources/issues
**Vercel Docs:** https://vercel.com/docs
**Payhip Support:** https://payhip.com/support

---

## ✅ Deployment Checklist

Before announcing the site:

- [ ] Logo uploaded and displaying correctly
- [ ] All 12 products updated with real info
- [ ] Payhip buttons integrated (test purchase)
- [ ] Bundle section updated with real bundle
- [ ] Testimonials updated (or removed if none yet)
- [ ] FAQ answers reflect your actual policies
- [ ] Custom domain working (resources.robpacpublishing.com)
- [ ] Newsletter popup email collection working
- [ ] Mobile responsive check (test on phone)
- [ ] All links working (check footer links)
- [ ] Analytics installed (if using)
- [ ] Test purchase flow end-to-end

---

## 📈 Marketing Launch Checklist

After site is live:

- [ ] Announce on social media
- [ ] Email existing list (if any)
- [ ] Post in relevant Facebook groups
- [ ] Update main site with link to resources
- [ ] Create lead magnet funnel
- [ ] Set up email sequences in Payhip
- [ ] Monitor analytics and conversions

---

## 🎯 Future Enhancements

Consider adding:
- Product search functionality
- Customer reviews/ratings
- Live chat support (e.g., Tidio)
- Blog section for content marketing
- Affiliate program integration
- Multi-language support (if targeting non-US)

---

**Built with:** HTML, Tailwind CSS, JavaScript
**Hosted on:** Vercel
**Payments via:** Payhip

Good luck with your launch! 🚀
# robpac-resources
# robpac-resources
