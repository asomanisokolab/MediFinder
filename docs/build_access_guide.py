"""Build docs/FindCare-Ghana-How-Access-Works.pdf.

    python -m pip install reportlab
    python docs/build_access_guide.py

Edit the text here and rerun whenever the access workflow changes.
"""
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    Flowable,
    KeepTogether,
    PageBreak,
    Paragraph,
    Preformatted,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

OUTPUT = Path(__file__).resolve().parent / "FindCare-Ghana-How-Access-Works.pdf"
TEAL = colors.HexColor("#0f766e")
AMBER = colors.HexColor("#d97706")
INK = colors.HexColor("#1f2937")
SOFT = colors.HexColor("#4b5563")
TINT = colors.HexColor("#e6f4f1")
LINE = colors.HexColor("#d1d5db")
CODE_BG = colors.HexColor("#f3f4f6")
FOOTER = "FindCare Ghana | Plain-language access guide"

base = getSampleStyleSheet()
body = ParagraphStyle("body", parent=base["Normal"], fontName="Helvetica",
                      fontSize=10, leading=14, textColor=INK, spaceAfter=6)
small = ParagraphStyle("small", parent=body, fontSize=9, leading=12)
title = ParagraphStyle("title", parent=body, fontName="Helvetica-Bold", fontSize=26,
                       leading=32, textColor=TEAL, alignment=TA_CENTER, spaceAfter=4)
subtitle = ParagraphStyle("subtitle", parent=body, fontSize=11, leading=15,
                          textColor=SOFT, alignment=TA_CENTER, spaceAfter=14)
h1 = ParagraphStyle("h1", parent=body, keepWithNext=1, fontName="Helvetica-Bold", fontSize=17,
                    leading=22, textColor=TEAL, spaceBefore=12, spaceAfter=6)
h2 = ParagraphStyle("h2", parent=body, keepWithNext=1, fontName="Helvetica-Bold", fontSize=11.5,
                    leading=15, spaceBefore=8, spaceAfter=3)
code = ParagraphStyle("code", parent=body, fontName="Courier", fontSize=8.5, leading=11,
                      backColor=CODE_BG, borderPadding=6, leftIndent=6, rightIndent=6,
                      spaceBefore=4, spaceAfter=10)


class Logo(Flowable):
    """The FindCare Ghana mark: medical cross with a pulse line, plus wordmark."""

    def __init__(self, size=0.8 * inch):
        super().__init__()
        self.size = size
        self.width, self.height = 4.2 * inch, size

    def draw(self):
        c, s = self.canv, self.size
        c.setFillColor(TEAL)
        c.roundRect(0, 0, s, s, s * 0.27, stroke=0, fill=1)
        u = s / 64.0
        c.setFillColor(colors.white)
        c.rect(27 * u, 12 * u, 10 * u, 40 * u, stroke=0, fill=1)
        c.rect(12 * u, 27 * u, 40 * u, 10 * u, stroke=0, fill=1)
        c.setStrokeColor(colors.HexColor("#fca5a5"))
        c.setLineWidth(3.5 * u)
        c.setLineCap(1)
        c.setLineJoin(1)
        points = [(8, 41), (20, 41), (25, 33), (32, 48), (39, 36), (44, 41), (56, 41)]
        path = c.beginPath()
        path.moveTo(points[0][0] * u, s - points[0][1] * u)
        for x, y in points[1:]:
            path.lineTo(x * u, s - y * u)
        c.drawPath(path, stroke=1, fill=0)
        c.setFillColor(TEAL)
        c.setFont("Helvetica-Bold", s * 0.5)
        c.drawString(s + 0.15 * inch, s * 0.3, "FindCare")
        width = c.stringWidth("FindCare", "Helvetica-Bold", s * 0.5)
        c.setFillColor(AMBER)
        c.setFont("Helvetica-Bold", s * 0.36)
        c.drawString(s + 0.25 * inch + width, s * 0.3, "Ghana")


def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(LINE)
    canvas.line(0.75 * inch, 0.7 * inch, letter[0] - 0.75 * inch, 0.7 * inch)
    canvas.setFont("Helvetica", 8.5)
    canvas.setFillColor(SOFT)
    canvas.drawString(0.75 * inch, 0.5 * inch, FOOTER)
    canvas.drawRightString(letter[0] - 0.75 * inch, 0.5 * inch, f"Page {doc.page}")
    canvas.restoreState()


def p(text, style=body):
    return Paragraph(text, style)


def steps(*items):
    return [p(f"{n}. {text}") for n, text in enumerate(items, start=1)]


def commands(text):
    # Kept whole: a command split across two pages is easy to copy wrongly.
    return KeepTogether([Preformatted(text.strip("\n"), code)])


def grid(rows, widths, header=False):
    data = [[p(f"<b>{a}</b>", small), p(b, small)] for a, b in rows]
    table = Table(data, colWidths=widths)
    style = [
        ("BOX", (0, 0), (-1, -1), 0.5, LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, LINE),
        ("BACKGROUND", (0, 0), (0, -1), TINT),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]
    if header:
        style.append(("BACKGROUND", (0, 0), (-1, 0), TINT))
    table.setStyle(TableStyle(style))
    return table


def story():
    s = [
        Logo(),
        Spacer(1, 18),
        p("FindCare Ghana", title),
        p("A plain-language guide to the public site, organization administrators, "
          "the system-wide superadmin, the facility directory, and analytics and "
          "Google setup", subtitle),
        p("Who uses FindCare?", h1),
        grid([
            ("Public visitors",
             "Search for hospitals, clinics, pharmacies and medical stores, ambulance "
             "services, hearse services and caregivers. No account is needed."),
            ("Organization admin",
             "Staff of one listed organization. They sign in to keep that listing "
             "up to date: beds, services, fleet, map location and their own password."),
            ("Superadmin",
             "Oversees the whole system: reviews contact requests, creates listings "
             "and logins, manages directory records and organization admins, and "
             "reviews recorded changes."),
        ], [1.9 * inch, 5.1 * inch]),
        Spacer(1, 12),
        p("<b>Contact FindCare Ghana:</b> info@findcareghana.com, and @findcareGh on "
          "Instagram, X and Facebook. These appear in the footer of every public page "
          "and on the Contact us page."),
        p("<b>Important:</b> the directory has not been verified yet. About 2,400 "
          "facilities come from OpenStreetMap (section 5) and 59 were entered by hand. "
          "Some phone numbers are placeholders and others may be out of date. Do not rely "
          "on them in an emergency. The website displays a warning until the "
          "information is verified."),
        p("This guide explains access and account responsibilities. It is not a medical "
          "or emergency-response guide."),
        PageBreak(),

        p("1. How an organization gets listed", h1),
        p("There is no self-registration. Organizations cannot create their own "
          "accounts. Every listing and login is created by a superadmin."),
        p("Step 1: the organization contacts us", h2),
        p("On the public site, the organization opens <b>Contact us</b> and sends its "
          "facility name, type, phone number and email, with an optional contact name "
          "and message. The types are: Hospital (government), Hospital (private), "
          "Clinic, Pharmacy / medical store, Ambulance service, Hearse service and "
          "Caregiver. A request does not create an account."),
        p("Step 2: the superadmin checks and approves", h2),
        *steps(
            "Open <b>/superadmin</b> and find the request under <b>Contact requests</b>.",
            "Confirm the organization is real and that the email and phone belong to it, "
            "for example by calling the number.",
            "Click <b>Approve and create login</b>. The form is filled in from the "
            "request. Choose the region, and for hospitals and clinics the classification "
            "level. Coordinates are optional.",
            "Click <b>Create login</b>. This creates the listing and a "
            "login for the organization's email with a random default password.",
        ),
        p("If the request is not genuine, click <b>Reject</b>. The organization is not "
          "told automatically."),
        p("Step 3: the superadmin emails the login details", h2),
        p("The website does not send email. After saving, the dashboard shows the "
          "finished login message once, with the sign-in link, the organization's email "
          "and its default password. The superadmin sends it to the organization's "
          "email address from their own mailbox, for example info@findcareghana.com:"),
        *steps(
            "<b>Open in email app</b> opens a new email to the organization with the "
            "subject and message filled in. Check it and press send.",
            "Or <b>Copy message</b> and paste it into webmail such as Gmail or Outlook, "
            "addressed to the organization's email.",
        ),
        p("<b>The default password is shown only once</b>, so send the message before "
          "leaving the page."),
        p("Step 4: the organization signs in and takes over", h2),
        *steps(
            "The organization signs in at <b>https://findcareghana.com/admin</b> with its "
            "email and the default password.",
            "It must choose its own password (at least 12 characters) before anything "
            "else. From then on only the organization knows its password.",
            "It opens <b>Advanced settings</b> and sets its map location. It can type the "
            "latitude and longitude from Google Maps, or press <b>Use this device's "
            "location</b> while standing at the entrance. Points outside Ghana are "
            "rejected.",
            "It keeps its listing current: bed counts and services for hospitals and "
            "clinics, fleet availability for ambulance services.",
        ),
        p("<b>A new listing is hidden from public search and emergency mode until its "
          "location is set</b>, so no one is sent to a guessed position. If the "
          "superadmin enters coordinates when creating the listing, it appears "
          "immediately. Emergency mode only ever shows hospitals and clinics."),
        p("Changing the password later", h2),
        p("Whenever an organization wants a new password, it changes it itself: sign "
          "in, open <b>Advanced settings</b>, and under <b>Change password</b> enter the "
          "current password and the new one twice."),
        p("Lost password", h2),
        p("An organization that cannot sign in contacts FindCare at "
          "info@findcareghana.com or @findcareGh. The superadmin then:"),
        *steps(
            "Confirms it is really them, for example by calling the listing's phone "
            "number.",
            "Clicks <b>Reset password</b> next to their login under <b>Organization "
            "admins</b>. The lost password stops working at once.",
            "Emails them the ready-made \"password was reset\" message with the new "
            "default password, using <b>Open in email app</b> or <b>Copy message</b>.",
        ),
        p("The organization signs in with the new default password and must choose its "
          "own new password straight away. The superadmin never sees or chooses the "
          "organization's own password."),

        p("2. Creating the superadmin", h1),
        p("Superadmins cannot be created through the website or the demo seed. An "
          "authorized operator creates one from the Droplet shell."),
        p("Step 1: go to the project folder and run the create command", h2),
        p("Use your own email and name:"),
        commands('cd /opt/MediFinder\n'
                 'sudo docker compose exec app python -m app.superadmins create '
                 'you@findcareghana.com "Your Name"'),
        p("Step 2: copy the password it prints", h2),
        p("The command generates a strong random password and prints it once, like "
          "this:"),
        commands("Created superadmin account for you@findcareghana.com.\n"
                 "Password (shown once -- store it in a password manager now):\n"
                 "  mhVXnIu1-E5vz-ImKIC5I2Sr"),
        p("<b>Copy the password straight away into a password manager.</b> It is shown "
          "only once, is not stored anywhere in plain text, and is not emailed."),
        p("Step 3: sign in", h2),
        p("Open <b>https://findcareghana.com/superadmin</b> and sign in with that email "
          "and password."),
        p("If the superadmin password is lost", h2),
        p("Generate a new one, printed once in the same way:"),
        commands("sudo docker compose exec app python -m app.superadmins reset-password "
                 "you@findcareghana.com"),
        p("If something goes wrong", h2),
        grid([
            ("An account already uses this email",
             "That email is already a superadmin or an organization login. Use "
             "reset-password if it is your superadmin account, or choose another email."),
            ("service \"app\" is not running",
             "Start the app with <font name='Courier'>sudo docker compose up -d</font>, "
             "then run the create command again."),
            ("no configuration file provided",
             "You are in the wrong folder. Run "
             "<font name='Courier'>cd /opt/MediFinder</font> first."),
        ], [2.2 * inch, 4.8 * inch]),
        Spacer(1, 8),
        p("You can create more superadmins the same way, one email each. Give this "
          "access only to people trusted with every account and listing."),

        p("3. What the superadmin can manage", h1),
        p("The protected <b>/superadmin</b> dashboard is the system-wide management "
          "area. The superadmin can:"),
        *steps(
            "Review contact requests, then approve them (create the listing and login) or "
            "reject them.",
            "Create a listing and login without a request, under <b>Add an "
            "organization</b>.",
            "See every organization admin and whether they are still <i>Awaiting first "
            "sign-in</i> (still on the default password). <b>Reset password</b> gives an "
            "organization that lost its password a new default password (see section 1). "
            "<b>Revoke access</b> removes the login. The superadmin never sees an "
            "organization's own password.",
            "Edit every facility and ambulance-provider field, including category, "
            "location, contact details, services, insurance, bed or fleet counts, "
            "coverage and verification status. The <i>Map location</i> column shows "
            "listings still hidden because no location is set.",
            "Review recorded organization-admin updates and superadmin changes.",
        ),
        p("Permanent deletion", h2),
        p("<b>Deletion is permanent. There is no recycle bin or undo button.</b> The "
          "dashboard asks for confirmation first. Deleting a facility also deletes its "
          "related directory records and organization-admin logins. Deleting an "
          "ambulance provider also removes its fleet and coverage records and admins, "
          "and clears facility links to it. Check the name and ID before confirming."),
        p("Change history", h2),
        p("The dashboard displays the latest 200 recorded changes, including listings "
          "created by the superadmin, location updates by organizations, edits and "
          "deletions."),

        p("4. Updating the Droplet safely", h1),
        p("After the update has been pushed to GitHub, run these commands on the "
          "Droplet:"),
        commands("cd /opt/MediFinder\n"
                 "git pull --ff-only origin main\n"
                 "sudo docker compose up -d --build app\n"
                 "sudo docker compose ps\n"
                 "sudo docker compose logs --tail=50 app\n"
                 "curl http://127.0.0.1:8000/api/v1/health\n"
                 "sudo docker compose exec app python -m app.directory_import"),
        p("The last command loads or refreshes the facility directory (section 5). It "
          "is safe to run after every update. After any change to the website, press "
          "<b>Ctrl+F5</b> in the browser so it loads the new design."),
        p("On startup the application adds any new tables and columns by itself. "
          "<b>Do not reset or reseed the production database.</b> Rebuilding only the "
          "app keeps the PostgreSQL data volume and existing records. Back up the "
          "database volume before large updates. After this update, existing listings "
          "are all marked <i>hospital</i>, so change clinics and pharmacies to the "
          "right category in the dashboard."),
        p("Give superadmin access only to a person trusted to manage all FindCare "
          "accounts and directory information. Replace demo accounts and placeholder "
          "data before real use."),

        p("5. The facility directory", h1),
        p("FindCare ships with about <b>2,400 health facilities from across Ghana</b>, "
          "taken from OpenStreetMap, the free map of the world that anyone can edit. "
          "Google Maps was not copied, because its terms forbid it."),
        grid([
            ("What is included",
             "About 1,050 pharmacies and chemical sellers, about 950 clinics (including "
             "CHPS compounds and health centres), about 365 hospitals, a few funeral "
             "homes (hearse services) and care homes."),
            ("Where each one is",
             "Exact GPS position, region, district (metropolitan, municipal or district "
             "assembly), city or town, and community. All 16 regions are covered. The "
             "district comes from the official boundary the point falls inside."),
            ("Contact details",
             "Phone numbers, opening hours and websites appear only where map volunteers "
             "recorded them, about 1 record in 8. None has been called."),
            ("Services",
             "Only what the place is known to be: pharmacy, dentist, laboratory, eye "
             "care, outpatient, or antenatal care and immunisation for CHPS compounds. "
             "Nothing is guessed."),
            ("Coverage gaps",
             "Busy cities are well mapped. Rural areas, and the North East and Savannah "
             "regions, have far fewer entries. Caregivers and hearse services barely "
             "exist in open data, so Contact us is the way to list them."),
        ], [1.6 * inch, 5.4 * inch]),
        Spacer(1, 8),
        p("Loading it on the Droplet", h2),
        commands("cd /opt/MediFinder\n"
                 "sudo docker compose exec app python -m app.directory_import"),
        p("It prints how many places were added, merged, refreshed, left alone or "
          "skipped. It <b>never deletes anything</b> and is safe to run again."),
        p("Rules the import follows", h2),
        *steps(
            "A listing that an organization manages (it has a login) or that has been "
            "verified is never changed. It belongs to the organization.",
            "When an OpenStreetMap place matches a hand-entered listing (same name, within "
            "1 km), the two become one record. It takes the map's location, district, "
            "community and any real phone number, and keeps the hand-entered "
            "classification, services, insurance and beds.",
            "Every imported listing starts as <i>unverified</i>. Its page says the data "
            "comes from OpenStreetMap and has not been confirmed by the facility.",
        ),
        p("Credit to OpenStreetMap", h2),
        p("The OpenStreetMap licence (ODbL) requires credit wherever the data is shown. "
          "The site footer and every imported facility page say <i>(c) OpenStreetMap "
          "contributors</i>. Keep these credits."),
        p("Making the data reliable", h2),
        p("Before relying on the directory, call facilities to confirm their phone "
          "numbers and correct them in the superadmin dashboard. Facilities that want "
          "to manage their own listing use <b>Contact us</b>, as in section 1."),

        p("6. Website pages", h1),
        p("Every FindCare page follows a standard launch checklist:"),
        grid([
            ("Page not found", "A branded 404 page with links back to search, ambulances "
             "and the 112 number, instead of a blank error."),
            ("Emergency first", "The red <b>Emergency - find help now</b> button is at "
             "the top of the home page. On phones a bar with <b>Emergency help</b> and "
             "<b>Call 112</b> stays at the bottom of the screen."),
            ("Titles and previews", "Every page has its own title and description. "
             "Links shared on WhatsApp, Facebook or X show a FindCare preview image."),
            ("Icons", "Browser-tab icon, phone home-screen icons and app icons."),
            ("Forms", "The contact form explains each mistake under the field and shows "
             "<i>Sending...</i> while it works. Afterwards it opens a thank-you page "
             "explaining the next steps."),
            ("Legal", "Privacy policy and Terms of use, linked in every footer. They "
             "follow Ghana's Data Protection Act, 2012 (Act 843). Have a lawyer review "
             "them."),
            ("Search engines", "robots.txt and sitemap.xml are made automatically "
             "(section 8)."),
            ("Cookies and statistics", "A cookie banner and Google Analytics, only "
             "after setup (section 7)."),
        ], [1.6 * inch, 5.4 * inch]),

        p("7. Setting up Google Analytics", h1),
        p("Google Analytics shows how many people visit FindCare, from where and which "
          "pages they use. It stays off until you add your ID."),
        *steps(
            "Go to <b>analytics.google.com</b> and sign in with the Google account that "
            "should own the statistics.",
            "Click <b>Admin</b> (gear icon), then <b>Create</b> and <b>Property</b>. Name "
            "it <i>FindCare Ghana</i>, choose time zone <i>Ghana</i> and currency "
            "<i>Ghanaian Cedi</i>, and continue through the questions.",
            "When asked for a data stream choose <b>Web</b>, enter "
            "<b>findcareghana.com</b>, and click <b>Create stream</b>.",
            "Copy the <b>Measurement ID</b> at the top right. It looks like "
            "<font name='Courier'>G-ABC123XYZ</font>.",
            "On the Droplet, add it to the settings file and restart the app:",
        ),
        commands("cd /opt/MediFinder\n"
                 "nano .env\n"
                 "#   add this line, with your own ID:\n"
                 "#   MEDIFINDER_GA_MEASUREMENT_ID=G-ABC123XYZ\n"
                 "#   save with Ctrl+O, Enter, then exit with Ctrl+X\n"
                 "sudo docker compose up -d app\n"
                 "curl -s https://findcareghana.com/site-config.js"),
        p("The last command should print your ID. Then open the site in a private "
          "browser window. The cookie banner appears; press <b>Accept</b>. Within a "
          "minute or two your visit shows in Google Analytics under <b>Reports</b> then "
          "<b>Realtime</b>."),
        p("How the cookie banner works", h2),
        *steps(
            "Statistics are collected <b>only after a visitor presses Accept</b>. If "
            "they press Decline, nothing is sent to Google.",
            "Visitors can change their mind at any time with <b>Cookie settings</b> at "
            "the bottom of every page.",
            "To switch analytics off, delete the ID from .env and run "
            "<font name='Courier'>sudo docker compose up -d app</font> again. The banner "
            "disappears too.",
        ),

        p("8. Getting found on Google (Search Console)", h1),
        p("Google Search Console tells Google about every FindCare page and shows "
          "which searches lead people to the site."),
        p("Step 1: prove you own the domain", h2),
        *steps(
            "Go to <b>search.google.com/search-console</b> and click <b>Add "
            "property</b>.",
            "Choose <b>Domain</b> (the left box), type <b>findcareghana.com</b>, and "
            "click <b>Continue</b>.",
            "Google shows a TXT record starting with "
            "<font name='Courier'>google-site-verification=</font>. Copy it.",
            "Sign in to the company that manages your domain's DNS (where the A record "
            "for the Droplet was set). Add a new <b>TXT</b> record with name/host "
            "<b>@</b> and the copied value, then save.",
            "Back in Search Console click <b>Verify</b>. DNS can take a few minutes to "
            "a few hours; if it fails, wait and click Verify again.",
        ),
        p("If you cannot change the DNS, choose <b>URL prefix</b> instead and the "
          "<b>HTML file</b> method. Put the file name Google gives you (for example "
          "<font name='Courier'>google1234abcd.html</font>) in .env as "
          "<font name='Courier'>MEDIFINDER_GOOGLE_VERIFICATION_FILE=google1234abcd.html"
          "</font>, run <font name='Courier'>sudo docker compose up -d app</font>, then "
          "click Verify."),
        p("Step 2: send Google the list of pages", h2),
        *steps(
            "In the left menu open <b>Sitemaps</b>, type <b>sitemap.xml</b> and click "
            "<b>Submit</b>. The status should become <i>Success</i>.",
            "Open <b>URL inspection</b>, paste <b>https://findcareghana.com/</b> and "
            "click <b>Request indexing</b>.",
            "Over the next days, check <b>Pages</b> (what Google has added) and "
            "<b>Performance</b> (searches that showed FindCare).",
        ),
        p("What FindCare does automatically", h2),
        grid([
            ("/robots.txt", "Tells search engines they may read the public site, and "
             "keeps the sign-in pages and the API out of search."),
            ("/sitemap.xml", "Lists the public pages and every facility and ambulance "
             "provider page. New listings are added automatically, so you only submit "
             "it once."),
            ("Page details", "Each page tells Google its main address and title, and "
             "the home page describes FindCare Ghana as an organization with its "
             "social media accounts."),
        ], [1.6 * inch, 5.4 * inch]),
        Spacer(1, 8),
        p("Search results take days to weeks to appear, and new sites usually start "
          "low. Sharing the site and its facility pages on @findcareGh helps."),
    ]
    return s


def main() -> None:
    doc = SimpleDocTemplate(
        str(OUTPUT), pagesize=letter,
        leftMargin=0.75 * inch, rightMargin=0.75 * inch,
        topMargin=0.75 * inch, bottomMargin=0.95 * inch,
        title="FindCare Ghana - How access works", author="FindCare Ghana",
    )
    doc.build(story(), onFirstPage=footer, onLaterPages=footer)
    print(f"Wrote {OUTPUT}")


if __name__ == "__main__":
    main()
