# Deploying Tagalong for free

Everything here costs nothing and runs on open-source software: Postgres,
Redis, SeaweedFS, Caddy and Node on one free server, a free DuckDNS name,
free HTTPS from Let's Encrypt, Gmail for sign-in emails, and Expo's free
build service for the Android app.

You'll end up with:

- `https://app.<your-name>.duckdns.org`: the web app, which also opens invite links
- `https://api.<your-name>.duckdns.org`: the API and live updates
- `https://files.<your-name>.duckdns.org`: photos and files
- An Android app (APK) you can install and send to friends

Set aside about two hours the first time. Steps 1–3 are accounts; step 4 is
the server; step 5 is the phone app.

---

## 1. A free server (Oracle Cloud "Always Free")

Oracle gives every account a permanently free ARM server with up to
4 CPU cores and 24 GB of memory, which is far more than Tagalong needs.

1. Go to **cloud.oracle.com** and choose **Sign up**.
   - Pick a **home region** near you (e.g. *India West (Mumbai)* or
     *India South (Hyderabad)*). It can't be changed later.
   - Oracle asks for a card **only to check you're a real person**. Always
     Free resources are never charged, and nothing is charged unless you
     choose to upgrade the account to "Pay As You Go". Don't upgrade.
2. In the console, open **Compute → Instances → Create instance**.
   - **Name:** `tagalong`
   - **Image:** click *Edit* → *Change image* → **Ubuntu 24.04** (the plain
     one, not "Minimal").
   - **Shape:** *Change shape* → **Ampere** → `VM.Standard.A1.Flex` with
     **2 OCPUs and 12 GB memory**. It says "Always Free-eligible".
   - **SSH keys:** choose *Generate a key pair for me* and **download both
     keys**. Keep the private key safe; it's the only way in.
   - **Boot volume:** tick *Specify a custom size* and set **100 GB** (up to
     200 GB is free).
   - Click **Create**. If it says "Out of capacity", try another
     *Availability domain* in the same screen, or try again later.
3. When it's running, copy its **Public IP address** from the instance page.
4. Open the web ports. On the instance page, click the **Subnet** link →
   the **Default Security List** → **Add Ingress Rules**, and add two rules:
   - Source CIDR `0.0.0.0/0`, IP protocol TCP, destination port `80`
   - Source CIDR `0.0.0.0/0`, IP protocol TCP, destination port `443`
5. Connect from your laptop's terminal (replace the key path and IP):
   ```bash
   chmod 600 ~/Downloads/ssh-key-*.key
   ssh -i ~/Downloads/ssh-key-*.key ubuntu@YOUR.SERVER.IP
   ```
6. Ubuntu on Oracle also has its own firewall. On the server, run:
   ```bash
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
   sudo netfilter-persistent save
   ```

> Oracle can reclaim an Always Free server that sits almost completely idle
> for a week. A server people actually use won't be, but if it ever
> disappears, your data is in the backups from step 4.9.

**No card at all?** You can run the same setup on an always-on computer at
home (an old laptop with Ubuntu works) by forwarding ports 80 and 443 on your
router to it. Many Indian broadband and mobile connections share one public
address between customers (CGNAT), which makes that impossible. Ask your ISP
for a "public IP", or use Oracle.

## 2. A free web address (DuckDNS)

1. Go to **duckdns.org** and sign in with GitHub or Google.
2. Under *domains*, type a name (e.g. `tagalong-priya`) and click **add domain**.
3. In **current ip**, paste your server's public IP and click **update ip**.

Your domain is `tagalong-priya.duckdns.org`. DuckDNS also answers for
`app.`, `api.` and `files.` in front of it, which is what Tagalong uses.
Check from your laptop after a minute:
```bash
ping -c 1 api.tagalong-priya.duckdns.org
```
It should show your server's IP.

## 3. Sign-in emails (a Gmail app password)

Tagalong signs people in with a 6-digit code sent by email. Any Gmail account
can send these for free (about 500 a day). A separate Gmail account just for
the app is tidier, but your own works.

1. Turn on **2-Step Verification** for the Google account
   (myaccount.google.com → *Security*). App passwords need it.
2. Go to **myaccount.google.com/apppasswords**, name it `Tagalong` and click
   **Create**. Copy the 16-letter password and **remove the spaces**.
3. Your mail settings will be (note `@` in the address becomes `%40`):
   ```
   SMTP_URL=smtps://you%40gmail.com:abcdabcdabcdabcd@smtp.gmail.com:465
   MAIL_FROM=Tagalong <you@gmail.com>
   ```

## 4. Put Tagalong on the server

All of this is typed on the server (over `ssh`).

1. Install Docker:
   ```bash
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker ubuntu
   exit
   ```
   Then `ssh` in again so the change applies.
2. Get the code. If the GitHub repo is private, create a token first:
   GitHub → *Settings* → *Developer settings* → *Personal access tokens* →
   *Fine-grained* → access to the `tagalong` repo with *Contents: Read-only*.
   ```bash
   git clone https://github.com/ChandrajCJ/tagalong.git
   cd tagalong
   ```
   (Paste the token as the password if it asks.)
3. Fill in your settings:
   ```bash
   cp deploy/.env.example deploy/.env
   nano deploy/.env
   ```
   Set `DOMAIN` (e.g. `tagalong-priya.duckdns.org`, no `https://`),
   `ACME_EMAIL` (your email), `SMTP_URL` and `MAIL_FROM` from step 3. Leave
   the secrets at the bottom empty. Save with **Ctrl+O, Enter, Ctrl+X**.
4. Generate the secrets:
   ```bash
   ./deploy/init.sh
   ```
5. Build and start everything (the first build takes 10–15 minutes):
   ```bash
   docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
   ```
6. Check it:
   ```bash
   docker compose -f deploy/docker-compose.yml --env-file deploy/.env ps
   curl https://api.YOUR-DOMAIN/health
   ```
   Every service should say `running` (`migrate` says `exited (0)`, which
   is correct: it updates the database and stops), and health should answer
   `{"status":"ok","db":"ok","redis":"ok"}`.
7. Open `https://app.YOUR-DOMAIN` on your phone, sign in with your email, and
   check the code arrives.
8. **Updating later:** after new commits are pushed,
   ```bash
   cd ~/tagalong && git pull
   docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
   ```
9. **Daily backups** of the database (kept for 14 days):
   ```bash
   crontab -e
   ```
   Add this line, then save:
   ```
   0 3 * * * /home/ubuntu/tagalong/deploy/backup.sh >> /home/ubuntu/backup.log 2>&1
   ```
   Copy `deploy/.env` and the `deploy/backups` folder to your laptop now and
   then (`scp`). Without `.env`'s secrets, a backup can't be restored.

**If something's wrong:** `docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs -f api`
(or `proxy`, `worker`, `gateway`). A certificate error usually means DuckDNS
doesn't point at the server yet, or ports 80/443 aren't open (step 1.4 and 1.6).

## 5. The Android app

Expo's build service is free (a limited number of builds a month, which is
plenty) and needs no card.

1. Create an account at **expo.dev**.
2. On your laptop, put your domain into the app's build settings: open
   `apps/mobile/eas.json` and replace every `YOUR-DOMAIN` with your DuckDNS
   name (e.g. `api.tagalong-priya.duckdns.org`).
3. Link the project and build:
   ```bash
   cd apps/mobile
   npx eas-cli@latest login
   npx eas-cli@latest init
   npx eas-cli@latest build --platform android --profile preview
   ```
   `init` adds the project's id to `app.json`; commit that change. When it
   asks to generate an Android keystore, say yes (Expo stores it for you).
   The build takes 10–20 minutes and ends with a link and a QR code.
4. Open the link on an Android phone and install the APK. Android will ask
   to allow installing from your browser; allow it for this install.
5. Send the same link to friends.

**Without any Expo account:** install Android Studio (free), then run
`npx expo prebuild --platform android` and build a release APK from the
`android` folder with `./gradlew assembleRelease`. Expo's service just saves
you setting up Android Studio and signing keys.

### Push notifications (optional, also free)

1. At **console.firebase.google.com**, create a project (the free *Spark*
   plan; no card).
2. *Add app* → Android, package name **`com.chandrajcj.tagalong`**. Download
   `google-services.json` and put it in `apps/mobile/`.
3. In Firebase: *Project settings → Service accounts → Generate new private
   key*. Then run `npx eas-cli@latest credentials`, choose Android → your
   build → *Google Service Account* → *FCM V1*, and upload that key file.
4. Tell Claude (or add `"googleServicesFile": "./google-services.json"` under
   `android` in `app.json`) and build again.

### iPhone

There's no free way to put an app on other people's iPhones: Apple requires
a $99/year developer account for TestFlight or the App Store. Until then,
iPhone friends can use the web app at `https://app.YOUR-DOMAIN` in Safari
(*Share → Add to Home Screen* makes it feel like an app). Everything works
there except push notifications and the photo library's location fallback.

---

## Paying back with UPI

On a trip kept in rupees (INR), anyone who adds their **UPI ID** under
**Profile** can be paid in one tap: the person who owes sees **Pay with UPI**
in *Settle up*, which opens Google Pay, PhonePe, Paytm, BHIM or their bank's
app with the UPI ID and amount filled in. The money moves inside their UPI
app, which can use any linked bank account (and RuPay credit cards where the
app supports it). Tagalong never sees or touches it, so after paying, the app
asks them to confirm, and records the payment.

- **Cards and net banking can't be prefilled** the same way: that needs a
  payment gateway, which charges a fee on every payment. UPI is free.
- **Some UPI apps limit payments started from other apps** (they may warn,
  or cap the amount, for safety). If one refuses, the person can pay the UPI
  ID shown in Tagalong by hand and then tap *Mark paid*.
- UPI is rupees only, so trips in other currencies keep *Mark paid*.
