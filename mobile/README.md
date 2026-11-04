# FindCare Ghana mobile app

An Android app (iOS ready to add) containing **only the public directory**:

- **Find care:** search, filters and Emergency mode
- **Ambulance:** providers covering your area
- **Contact us:** request a listing

These also link to facility profiles, the thank-you page, and the privacy
policy and terms. There are **no admin or superadmin pages** in the app, and
no links to them. Organizations manage their listing on the website at
`findcareghana.com/admin`.

The app reuses the website's own pages and scripts from `../frontend`, so a
change to the website flows into the next app build. It shows live data by
calling the API at `https://findcareghana.com`.

## How it is built

| Piece | What it does |
| --- | --- |
| [Capacitor](https://capacitorjs.com) 8 | Native Android shell around the pages |
| `scripts/build-www.mjs` | Copies the public pages into `www/`. It removes admin links, website-only analytics and the cookie banner, and points the pages at the live API. The build fails if an admin link would slip through |
| `app.css` | App-only styles: room for the status bar, and the Emergency / Call 112 bar on every screen size |
| `scripts/make_icons.py` | Draws the launcher icons and splash screens |
| `android/` | The Android Studio project. Location permission is used for "Use my location" and Emergency mode |
| `../.github/workflows/android-app.yml` | Builds the app on GitHub |

## Getting the app (no Android Studio needed)

Every push to `main` that changes `mobile/` or `frontend/` builds the app on
GitHub:

1. Open the repository on GitHub, go to **Actions** and choose **Android app**.
2. Open the latest green run and scroll to **Artifacts**.
3. Download **findcare-ghana-debug-apk** and unzip it to get `app-debug.apk`.
4. Copy it to an Android phone and open it. Allow "install unknown apps" for
   the file manager or browser when asked.

You can also start a build without a code change: **Actions → Android app →
Run workflow**.

The debug APK is for testing and sharing directly. The Play Store needs the
signed bundle described below.

## Publishing on Google Play

1. **Create a signing key once**, on any computer with Java installed. Keep
   the file and passwords safe: every future update must be signed with this
   same key.

   ```bash
   keytool -genkeypair -v -keystore findcare-release.jks -alias findcare \
     -keyalg RSA -keysize 2048 -validity 10000
   ```

2. **Add four repository secrets** under GitHub → **Settings → Secrets and
   variables → Actions**:

   | Secret | Value |
   | --- | --- |
   | `ANDROID_KEYSTORE_BASE64` | The key file as text: `base64 -w0 findcare-release.jks` (on Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("findcare-release.jks"))`) |
   | `ANDROID_KEYSTORE_PASSWORD` | The keystore password |
   | `ANDROID_KEY_ALIAS` | `findcare` |
   | `ANDROID_KEY_PASSWORD` | The key password |

3. Run the workflow again. It now also produces
   **findcare-ghana-play-store-bundle** (`app-release.aab`).
4. In the [Google Play Console](https://play.google.com/console) (one-time
   US$25 registration), create the app *FindCare Ghana* and upload the `.aab`
   under **Testing → Internal testing** first, then **Production**.
   - **Privacy policy URL:** `https://findcareghana.com/privacy.html`
   - **Data safety:** the app uses approximate and precise location only to
     find nearby care, without storing it. It also sends the contact form's
     details, which you enter yourself. No ads, no analytics in the app.
   - **Category:** Medical. Content rating questionnaire: no objectionable
     content.

Each GitHub build number becomes the app's `versionCode`, so every upload is
newer than the last. Change `versionName` in `android/app/build.gradle` for
user-visible versions.

## iPhone (iOS)

iOS apps can only be built on a Mac with Xcode and an Apple Developer account
(US$99 per year). On the Mac:

```bash
cd mobile
npm install
npm install @capacitor/ios@8.6.0
npm run build
npx cap add ios
npx cap open ios
```

In Xcode, add a "Location When In Use" description such as *"FindCare uses
your location to find the nearest hospitals, clinics and ambulances."*,
then archive and upload to App Store Connect.

## Working on the app locally

You need Node 22+, plus Android Studio with JDK 21 to run it on an emulator:

```bash
cd mobile
npm install
npm run sync      # build www/ from ../frontend and copy it into android/
npm run open      # open in Android Studio, then press Run
```

To test against a local server instead of the live site:

```bash
FINDCARE_API_ORIGIN=http://10.0.2.2:8000 npm run sync   # emulator's address for your PC
```

After `npx cap add android` regenerates the project, run
`python scripts/make_icons.py` again and restore the location permissions in
`android/app/src/main/AndroidManifest.xml`.

## Server requirements

- The app needs the live server to be on the latest version, so the
  district search works. Deploy the backend before releasing a new app.
- The API allows requests from any origin (`MEDIFINDER_CORS_ORIGINS=*`, the
  default). If you ever restrict it, include `https://localhost` (Android)
  and `capacitor://localhost` (iOS).
