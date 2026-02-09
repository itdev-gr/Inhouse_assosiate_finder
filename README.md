# Associate Finder

Dashboard για αναζήτηση επαγγελματιών (Videographer, Influencer, Models) ανά τοποθεσία. Τα δεδομένα φιλοξενούνται στο Firebase Firestore.

## Ρύθμιση

### 1. Μεταβλητές περιβάλλοντος

Δημιουργήστε αρχείο `.env` στη ρίζα του project (αντιγράψτε από `.env.example`) και συμπληρώστε τις τιμές του Firebase project σας:

```bash
cp .env.example .env
```

Παράδειγμα `.env`:

```
PUBLIC_FIREBASE_API_KEY=your_api_key
PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
PUBLIC_FIREBASE_PROJECT_ID=your_project_id
PUBLIC_FIREBASE_STORAGE_BUCKET=your_project.firebasestorage.app
PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
PUBLIC_FIREBASE_APP_ID=your_app_id
```

### 2. Firestore – Collection και Index

- **Collection**: `professionals`
- **Πεδία εγγράφου** (υποχρεωτικά): `category`, `location`, `name`
  - `category`: `"videographer"` | `"influencer"` | `"model"` | `"editor"`
  - `location`: string (π.χ. `"Athens"`, `"Thessaloniki"`)
  - `name`: string
- **Προαιρετικά**: `bio`, `imageUrl`, `contact`, `socialUrl`, `platform`, `mainRole`, `collaborationType`, `equipment`, `portfolioUrl`, `phone`, `email`, `createdAt`
- **Αναζήτηση τοποθεσίας**: `locationSearch` (array) – συμπληρώνεται αυτόματα από το import script· περιέχει κανονικοποιημένα tokens ώστε η αναζήτηση να δουλεύει με **Ελληνικά, Greeklish και Αγγλικά** (π.χ. Αθήνα, athina, Athens).

**Composite index**: Για την αναζήτηση ανά κατηγορία και τοποθεσία χρειάζεται composite index στο Firestore:

- Πήγαινε στο [Firebase Console](https://console.firebase.google.com) → το project σου → Firestore → Indexes.
- Πρόσθεσε composite index για το collection `professionals` με πεδία:
  - `category` (Ascending)
  - `locationSearch` (Array-contains)

Εναλλακτικά, τρέξε μία αναζήτηση από την εφαρμογή· αν λείπει το index, το Console θα σου δώσει σύνδεσμο για αυτόματη δημιουργία του.

### 3. Δοκιμαστικά δεδομένα (seed)

Μπορείς να προσθέσεις χειροκίνητα documents στο collection `professionals` από το Firestore Console (Add document), ή να χρησιμοποιήσεις δοκιμαστικά δεδομένα όπως:

| category     | location     | name        |
|-------------|-------------|-------------|
| videographer | Athens      | John Doe    |
| videographer | Athens      | Jane Smith  |
| influencer   | Thessaloniki | Alex K.     |
| model        | Athens      | Maria P.    |
| editor       | Athens      | Nick E.     |

Βεβαιώσου ότι το πεδίο `location` ταιριάζει ακριβώς με αυτό που πληκτρολογεί ο χρήστης (π.χ. `"Athens"` και όχι `"athens"` αν δεν κάνεις normalize).

### 4. Firestore Security Rules (production)

Για production ρύθμισε Firestore Security Rules (Firestore → Rules). Παράδειγμα για δημόσια ανάγνωση μόνο:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /professionals/{docId} {
      allow read: if true;
      allow write: if false;
    }
  }
}
```

Προσαρμόζεις αν χρησιμοποιείς authentication.

### 5. Εισαγωγή δεδομένων από Excel

Μπορείς να εισάγεις μαζικά δεδομένα από αρχείο Excel (.xlsx) στο Firestore με το script `scripts/import-excel.js`.

1. **Service account key**: Στο [Firebase Console](https://console.firebase.google.com) → Project Settings (εικονίδιο γραναζιού) → **Service accounts** → **Generate new private key**. Αποθήκευσε το JSON τοπικά (π.χ. `./private/serviceAccountKey.json`) και **μην το κάνεις ποτέ commit** (το `.gitignore` αγνοεί `serviceAccount*.json`).

2. **Εντολή εισαγωγής**:
   ```bash
   GOOGLE_APPLICATION_CREDENTIALS=./private/serviceAccountKey.json node scripts/import-excel.js ./path/to/your-file.xlsx
   ```

3. **Αντιστοίχιση columns**: Το script αναμένει την πρώτη σειρά του πρώτου sheet ως headers. Τα columns του Excel αντιστοιχίζονται στα πεδία Firestore ως εξής:

   | Excel column | Firestore field |
   |--------------|-----------------|
   | επαγγελματικός_τίτλος | category (normalized: Videographer/Editor → videographer/editor) |
   | σε_ποια_πόλη_ή_περιοχή | location |
   | ονοματεπώνυμο | name |
   | γιατί_σε_ενδιαφέρει_συνει | bio |
   | link_σε_portfolio_/_vimec | portfolioUrl |
   | αριθμός_τηλεφώνου | phone |
   | email | email |
   | created_time | createdAt |
   | platform | platform |
   | ποιος_είναι_ο_βασικός_σο | mainRole |
   | τι_είδους_συνεργασία_σε | collaborationType |
   | τι_εξοπλισμό_χρησιμοποιεί | equipment |

Μετά την εισαγωγή, τα δεδομένα εμφανίζονται στο dashboard με όλα τα πεδία (εξοπλισμός, portfolio, τηλέφωνο, email, κ.λπ.).

## Deploy στο Vercel

1. **Σύνδεση με GitHub**: Πήγαινε στο [Vercel](https://vercel.com) και σύνδεσε το GitHub account. Επίλεξε **Add New** → **Project** και κάνε import το repository `itdev-gr/Inhouse_assosiate_finder`.

2. **Build ρυθμίσεις**: Το Vercel αναγνωρίζει αυτόματα Astro. Αφήστε:
   - **Build Command**: `npm run build`
   - **Output Directory**: `.vercel/output/static` (ή αφήστε το default αν το προτείνει)
   - **Install Command**: `npm install`

3. **Environment Variables**: Πριν το πρώτο deploy, πρόσθεσε στο Vercel (Project → Settings → Environment Variables) όλες τις μεταβλητές από το `.env.example`:
   - `PUBLIC_FIREBASE_API_KEY`
   - `PUBLIC_FIREBASE_AUTH_DOMAIN`
   - `PUBLIC_FIREBASE_PROJECT_ID`
   - `PUBLIC_FIREBASE_STORAGE_BUCKET`
   - `PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
   - `PUBLIC_FIREBASE_APP_ID`

   Ορίστε τις για **Production** (και προαιρετικά Preview αν θέλετε τα ίδια σε PR previews).

4. **Deploy**: Πατήστε **Deploy**. Μετά το build θα πάρεις ένα URL τύπου `https://inhouse-assosiate-finder-xxx.vercel.app`.

Για επόμενα deploys, κάθε push στο `main` θα κάνει αυτόματα νέο deploy.

## Εντολές

| Εντολή           | Λειτουργία                          |
|------------------|--------------------------------------|
| `npm install`    | Εγκατάσταση dependencies            |
| `npm run dev`    | Dev server στο `localhost:4321`     |
| `npm run build`  | Build production στο `./dist/`       |
| `npm run preview`| Προεπισκόπηση του build τοπικά       |

## Δομή project

```
/
├── public/
├── scripts/
│   └── import-excel.js   # Εισαγωγή από .xlsx στο Firestore
├── src/
│   ├── lib/
│   │   └── firebase.ts   # Firebase init και Firestore
│   └── pages/
│       └── index.astro   # Dashboard (κατηγορίες, location, αποτελέσματα)
├── .env.example
└── package.json
```
