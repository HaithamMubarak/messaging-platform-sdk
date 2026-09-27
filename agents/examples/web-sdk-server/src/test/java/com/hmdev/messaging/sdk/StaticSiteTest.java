package com.hmdev.messaging.sdk;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Invariants of the static site that break quietly rather than loudly.
 *
 * The site is served from https://hmdevonline.com/messaging-platform/sdk/, not
 * the domain root, so a root-absolute path resolves to something that does not
 * exist — and nothing fails at build time when one is introduced. Likewise a
 * page can lose its social tags, or a sitemap entry can outlive the file it
 * points at, without any test noticing.
 */
class StaticSiteTest {

    private static final Path STATIC = Paths.get("src/main/resources/static");

    /** The pages people actually share a room link to. */
    private static final List<String> SHAREABLE = List.of(
            "apps/mini-games/air-hockey/index.html",
            "apps/mini-games/find-the-liar/index.html",
            "apps/mini-games/reactor/reactor-client.html",
            "apps/pictionary/index.html",
            "apps/chess/index.html",
            "apps/whiteboard/index.html",
            "apps/chat.html",
            // The feature page is shareable; app.html is not — it carries noindex,
            // because a log is opened from a link somebody was given.
            "apps/evidence-chain/index.html",
            "apps/dead-drop/index.html",
            "apps/under-the-hood/index.html",
            "apps/rewind/index.html");
    // apps/mini-games/blockparty/ is absent too: BlockParty moved to the apps
    // catalogue and what is left here is a noindex redirect.
    // apps/quickshare/quickshare.html is deliberately absent: QuickShare was
    // retired to a noindex redirect at Drop, and a redirect has nothing to
    // unfurl.

    /** Pages that must never be indexed, whether or not robots.txt is fetched. */
    private static final List<String> PRIVATE_PAGES = List.of(
            "apps/rewind/app.html",
            "apps/under-the-hood/app.html",
            "apps/dead-drop/app.html",
            "apps/evidence-chain/app.html",
            "admin/index.html",
            "admin/dashboard.html",
            "developer/index.html",
            "developer/dashboard.html",
            "developer/change-password.html",
            "apps/test-api-key/index.html");
    // stress-test.html was retired, so there is no page left to keep private.
    // Party Physics and Race Balls used to sit here as "built but not
    // published" — both are finished now, carry cards in the playground and
    // are listed in the sitemap, so they are public pages like any other game.

    private String read(String relative) throws IOException {
        Path path = STATIC.resolve(relative);
        assertThat(Files.exists(path)).as("%s exists", relative).isTrue();
        return Files.readString(path, StandardCharsets.UTF_8);
    }

    @Test
    @DisplayName("a playground heading that counts its entries counts them correctly")
    void playgroundHeadingsDoNotClaimAStaleCount() throws IOException {
        String page = read("playground.html");

        // "The four with a page of their own" sat above eight of them. A
        // heading that names a number is a claim a reader can check in one
        // glance, and it goes stale the moment somebody adds an entry -- so
        // check it here instead of hoping.
        Map<String, Integer> words = new LinkedHashMap<>();
        String[] names = {"two", "three", "four", "five", "six", "seven", "eight",
                          "nine", "ten", "eleven", "twelve"};
        for (int i = 0; i < names.length; i++) words.put(names[i], i + 2);

        // Split on the section headings, so each chunk holds one heading and
        // the entries that follow it.
        String[] sections = page.split("(?=<h2)");
        for (String section : sections) {
            Matcher h = Pattern.compile("<h2[^>]*>(.*?)</h2>", Pattern.DOTALL).matcher(section);
            if (!h.find()) continue;
            String heading = h.group(1).replaceAll("<[^>]*>", "").toLowerCase();
            int entries = section.split("class=\"entry-hit\"", -1).length - 1;
            if (entries == 0) continue;

            for (Map.Entry<String, Integer> w : words.entrySet()) {
                if (heading.matches(".*\\b" + w.getKey() + "\\b.*")) {
                    assertThat(entries)
                            .as("heading \"" + heading.trim() + "\" says " + w.getKey()
                                + " but " + entries + " entries follow it")
                            .isEqualTo(w.getValue());
                }
            }
        }
    }

    @Test
    @DisplayName("every playground entry shows a screenshot of itself, and the file is there")
    void playgroundEntriesCarryScreenshots() throws IOException {
        String page = read("playground.html");

        // The card-wide link is what makes something an entry — games and the
        // plain demos below them use different card classes, so counting one
        // of those two would quietly ignore the other five.
        int entries = page.split("class=\"entry-hit\"", -1).length - 1;
        // A floor, so `found == entries` below cannot pass on an empty page.
        // A floor pinned to today's exact total fails the next time one
        // entry moves, which is how this assertion came to be wrong at 20.
        assertThat(entries).isGreaterThan(10);

        Matcher m = Pattern.compile(
                "<figure class=\"entry-shot\"><img src=\"(img/playground/[^\"]+)\"[^>]*alt=\"([^\"]*)\">")
                .matcher(page);
        int found = 0;
        while (m.find()) {
            found++;
            Path shot = STATIC.resolve(m.group(1));
            assertThat(Files.exists(shot))
                    .as("screenshot referenced by the playground is missing: " + m.group(1))
                    .isTrue();
            // A thumbnail with no description is a thumbnail a screen reader
            // cannot report; "Screenshot" would pass a presence check and say
            // nothing, so require a real sentence.
            assertThat(m.group(2).length())
                    .as("alt text too short for " + m.group(1))
                    .isGreaterThan(30);
        }
        assertThat(found).isEqualTo(entries);
    }

    /*
     * Re-pinned 2026-09-26. The old pins (a `site-nav` header, no link to the
     * playground) were written the morning of 2026-09-15 and the hub refresh
     * that evening deliberately replaced both, without moving the test; it had
     * been red since. The promise underneath is what is pinned now: the hub
     * says what the product is and routes a visitor to trying, pricing and
     * starting — and the flagship apps are one click away.
     */
    @Test
    @DisplayName("the Hub says what the product is, and routes to quickstart, pricing and signup")
    void hubAnswersTheFirstQuestions() throws IOException {
        String home = read("hub.html");
        assertThat(home).contains("Build realtime apps");
        assertThat(home).contains("href=\"quickstart.html\"");
        assertThat(home).contains("href=\"pricing.html\"");
        assertThat(home).contains("href=\"developer/index.html?start=free\"");
        assertThat(home).contains("/messaging-platform/apps/rooms/");
        assertThat(home).contains("/messaging-platform/hub/sdk-guide.html");
    }

    /*
     * The hub may only name SDKs that exist in this repository, and the
     * experimental one must say so. A language chip is a promise that the
     * quickstart has a working tab for it.
     */
    @Test
    @DisplayName("the Hub names only real SDKs, each with a quickstart tab")
    void hubNamesOnlyRealSdks() throws IOException {
        String home = read("hub.html");
        String quickstart = read("quickstart.html");
        Matcher chip = Pattern.compile("class=\"mp-lang\" href=\"quickstart.html#(\\w+)\"").matcher(home);
        List<String> langs = new ArrayList<>();
        while (chip.find()) langs.add(chip.group(1));
        assertThat(langs).containsExactly("js", "python", "java", "cpp");
        for (String lang : langs) {
            assertThat(quickstart).contains("data-tab=\"" + lang + "\"");
        }
        assertThat(home).contains("C++ <small>experimental</small>");
    }

    @Test
    @DisplayName("browser documentation keeps the developer key on the developer's server")
    void browserDocumentationTeachesTemporaryKeyHandoff() throws IOException {
        String guide = read("WEB-AGENT-GUIDE.md");
        assertThat(guide).contains("/channels/api-access");
        assertThat(guide).contains("process.env.MESSAGING_PLATFORM_API_KEY");
        assertThat(guide).doesNotContain("agent.requestTempKey");
    }

    // ------------------------------------------------------------ meta tags

    @Test
    @DisplayName("every shareable page unfurls as something better than a bare URL")
    void shareablePagesCarrySocialMeta() throws IOException {
        List<String> missing = new ArrayList<>();
        for (String page : SHAREABLE) {
            String html = read(page);
            for (String tag : new String[] { "og:title", "og:description", "og:image",
                                             "og:url", "twitter:card",
                                             "name=\"description\"", "rel=\"canonical\"" }) {
                if (!html.contains(tag)) missing.add(page + " -> " + tag);
            }
        }
        assertThat(missing).isEmpty();
    }

    @Test
    @DisplayName("a page declares its description exactly once")
    void noDuplicateDescriptionTags() throws IOException {
        List<String> duplicated = new ArrayList<>();
        for (String page : SHAREABLE) {
            long count = Pattern.compile("<meta\\s+name=\"description\"")
                    .matcher(read(page)).results().count();
            if (count != 1) duplicated.add(page + " has " + count);
        }
        assertThat(duplicated).isEmpty();
    }

    @Test
    @DisplayName("operator pages carry noindex, which is what works when robots.txt is not at the root")
    void privatePagesAreNoindexed() throws IOException {
        List<String> exposed = new ArrayList<>();
        for (String page : PRIVATE_PAGES) {
            if (!read(page).contains("name=\"robots\"")) exposed.add(page);
        }
        assertThat(exposed).isEmpty();
    }

    // -------------------------------------------------------- relative paths

    @Test
    @DisplayName("the web manifest stays relative, or installing the PWA opens the wrong site")
    void manifestUsesRelativePaths() throws IOException {
        String manifest = read("site.webmanifest");

        assertThat(manifest).doesNotContain("\"/\"");
        Matcher m = Pattern.compile("\"(?:src|start_url|scope|url)\"\\s*:\\s*\"([^\"]+)\"")
                .matcher(manifest);
        List<String> absolute = new ArrayList<>();
        while (m.find()) {
            String value = m.group(1);
            if (value.startsWith("/") || value.startsWith("http")) absolute.add(value);
        }
        assertThat(absolute).isEmpty();
    }

    @Test
    @DisplayName("every file the manifest points at is actually there")
    void manifestTargetsExist() throws IOException {
        Matcher m = Pattern.compile("\"(?:src|url)\"\\s*:\\s*\"([^\"]+)\"")
                .matcher(read("site.webmanifest"));
        List<String> missing = new ArrayList<>();
        while (m.find()) {
            String target = m.group(1).replaceFirst("^\\./", "");
            if (!Files.exists(STATIC.resolve(target))) missing.add(target);
        }
        assertThat(missing).isEmpty();
    }

    // -------------------------------------------------------------- sitemap

    @Test
    @DisplayName("no sitemap entry outlives the page it points at")
    void sitemapOnlyListsPagesThatExist() throws IOException {
        // This tree is served at both /hub/ and /sdk/ (demos keep their /sdk/
        // URLs); /apps/ is apps-service, whose pages this build cannot see.
        String root = "https://hmdevonline.com/messaging-platform/";
        Matcher m = Pattern.compile("<loc>([^<]+)</loc>").matcher(read("sitemap.xml"));

        List<String> missing = new ArrayList<>();
        while (m.find()) {
            String loc = m.group(1);
            assertThat(loc).startsWith(root);
            String path = loc.substring(root.length());
            if (path.startsWith("apps/")) continue;
            assertThat(path).as(loc).matches("(hub|sdk)/.*");
            String relative = path.substring(4).split("\\?")[0];
            if (relative.isEmpty()) relative = "hub.html";
            if (!Files.exists(STATIC.resolve(relative))) missing.add(relative);
        }
        assertThat(missing).isEmpty();
    }

    @Test
    @DisplayName("the sitemap never advertises a page robots.txt is trying to hide")
    void sitemapExcludesPrivatePages() throws IOException {
        String sitemap = read("sitemap.xml");
        for (String page : PRIVATE_PAGES) {
            assertThat(sitemap).as("sitemap must not list %s", page).doesNotContain(page);
        }
    }

    // ----------------------------------------------------------- link health

    /**
     * Extension-free URLs that a controller serves, read from the controller
     * itself rather than listed here. Google's OAuth configuration points at
     * /privacy and /terms, so they are links with no file behind them — and
     * deleting the controller has to fail this test, not quietly re-break the
     * links it was added to keep working.
     */
    private static Set<String> controllerRoutes() throws IOException {
        Path controller = Paths.get(
                "src/main/java/com/hmdev/messaging/sdk/controller/LegalController.java");
        if (!Files.exists(controller)) return Set.of();
        Matcher m = Pattern.compile("@GetMapping\\(\\{([^}]*)\\}\\)")
                .matcher(Files.readString(controller, StandardCharsets.UTF_8));
        Set<String> routes = new HashSet<>();
        while (m.find()) {
            Matcher path = Pattern.compile("\"/([^\"]*)\"").matcher(m.group(1));
            while (path.find()) routes.add(path.group(1).replaceAll("/$", ""));
        }
        return routes;
    }

    @Test
    @DisplayName("no page links to a file that is not in the build")
    void internalLinksResolve() throws IOException {
        Pattern ref = Pattern.compile("(?:href|src)=\"([^\"#][^\"]*)\"");
        List<String> broken = new ArrayList<>();
        Set<String> routes = controllerRoutes();
        assertThat(routes).as("LegalController's extension-free routes").isNotEmpty();

        try (Stream<Path> pages = Files.walk(STATIC)) {
            for (Path page : pages.filter(p -> p.toString().endsWith(".html"))
                    // Generated bundles and vendored libraries are not ours to police,
                    // and the icon generator builds its hrefs from a template string.
                    .filter(p -> !p.toString().contains("generated-web-agent-js"))
                    .filter(p -> !p.toString().contains("/lib/") && !p.toString().contains("/libs/"))
                    .filter(p -> !p.toString().endsWith("generate-icons.html"))
                    .toList()) {

                Matcher m = ref.matcher(Files.readString(page, StandardCharsets.UTF_8));
                while (m.find()) {
                    String href = m.group(1);
                    if (href.startsWith("http") || href.startsWith("//") || href.startsWith("data:")
                            || href.startsWith("mailto:") || href.startsWith("javascript:")
                            || href.contains("${")) {
                        continue;
                    }
                    String path = href.split("[?#]")[0];
                    if (path.isEmpty()) continue;

                    // A controller serves this one; there is no file to find.
                    if (routes.contains(path.replaceAll("^.*/", ""))
                            && !path.contains(".")) {
                        continue;
                    }

                    // profile.html is served at the PLATFORM ROOT, one level
                    // above this tree, so its relative links are written from
                    // there: sdk/x is this tree's x, and apps/x belongs to
                    // apps-service. Resolving them like any other page's puts
                    // them at static/sdk/x, which is nothing.
                    if (page.getFileName().toString().equals("profile.html")
                            && !path.startsWith("/")) {
                        if (!path.startsWith("sdk/")) continue;
                        path = path.substring("sdk/".length());
                    }

                    // An absolute link is a GATEWAY path, not a repo path. The
                    // gateway serves this tree at /messaging-platform/sdk/ and
                    // the profile at the platform root, so map both back rather
                    // than exempting them -- an unresolvable absolute link is
                    // still a 404 for a real visitor.
                    String repoPath = path;
                    if (repoPath.startsWith("/messaging-platform/sdk/")) {
                        repoPath = repoPath.substring("/messaging-platform/sdk/".length());
                    } else if (repoPath.equals("/messaging-platform/profile.html")) {
                        repoPath = "profile.html";
                    } else if (repoPath.startsWith("/messaging-platform/")) {
                        // Another service owns it (apps, rooms-api). Not ours to check.
                        continue;
                    } else if (repoPath.startsWith("/")) {
                        repoPath = repoPath.substring(1);
                    }

                    Path target = path.startsWith("/")
                            ? STATIC.resolve(repoPath)
                            : page.getParent().resolve(repoPath);
                    // A link that climbs out of this tree points at something
                    // hosted beside us, not at a file we ship — the playground's
                    // CoShell card is one, resolving within /messaging-platform/.
                    // Whether that exists is not this build's business.
                    if (!target.normalize().startsWith(STATIC)) continue;
                    if (!Files.exists(target.normalize())) {
                        broken.add(STATIC.relativize(page) + " -> " + href);
                    }
                }
            }
        }
        assertThat(broken).isEmpty();
    }

    /*
     * Re-pinned 2026-09-26: the 2026-09-15 evening hub refresh made the
     * playground public on purpose (indexed, in the sitemap, linked as "Full
     * Playground"); this test still asserted the morning's opposite and had
     * been red since. Pin the decision that shipped.
     */
    @Test
    @DisplayName("the playground is a public, indexed page the hub links to")
    void playgroundIsPublic() throws IOException {
        assertThat(read("playground.html")).doesNotContain("noindex");
        assertThat(read("sitemap.xml")).contains("/messaging-platform/hub/playground.html");
        assertThat(read("hub.html")).contains("hub/playground.html");
    }

    // ------------------------------------------------------------- pricing

    /*
     * Prices live in data/plans.json and nowhere else, and a plan that cannot
     * be bought must say so. These are the two ways a pricing page lies:
     * a number that disagrees with the source, or a "Buy" on something not
     * for sale.
     */
    @Test
    @DisplayName("every plan in plans.json is well-formed, and only Free is sold today")
    void plansAreHonest() throws IOException {
        JsonNode data = new ObjectMapper().readTree(read("data/plans.json"));
        List<String> rowKeys = new ArrayList<>();
        data.get("rows").forEach(r -> rowKeys.add(r.get("key").asText()));

        List<String> names = new ArrayList<>();
        for (JsonNode plan : data.get("plans")) {
            names.add(plan.get("name").asText());
            for (String key : rowKeys) {
                assertThat(plan.get("limits").hasNonNull(key)).as(plan.get("id") + " limit " + key).isTrue();
            }
            String status = plan.get("status").asText();
            assertThat(status).isIn("available", "planned");
            if (!plan.get("id").asText().equals("free")) {
                assertThat(status).as(plan.get("id") + " is not on sale yet").isEqualTo("planned");
            }
            String href = plan.get("cta").get("href").asText();
            assertThat(Files.exists(STATIC.resolve(href.split("[?#]")[0])))
                    .as(plan.get("id") + " CTA " + href).isTrue();
        }
        assertThat(names).containsExactly("Free", "Starter", "Pro", "Business", "Enterprise");
        assertThat(data.get("notice").asText()).contains("not on sale");
    }

    @Test
    @DisplayName("the pricing page renders the service's plans rather than restating prices")
    void pricingPageReadsThePlanFile() throws IOException {
        String page = read("pricing.html");
        assertThat(page).contains("js/pricing.js");
        // Live plans from the service; plans.json only as the outage snapshot.
        assertThat(page).contains("js/plan-format.js");
        assertThat(read("js/plan-format.js")).contains("/billing/plans").contains("data/plans.json");
        assertThat(read("js/pricing.js")).contains("PlanFormat.load");
        // A price typed into the page would drift from the file the day it changes.
        assertThat(page).doesNotContainPattern("\\$\\d");
    }

    // ---------------------------------------------------------- quickstart

    /*
     * The quickstart's snippets were run against the live platform before
     * publishing (agents/examples/quickstart/README.md). These pin the three
     * details that silently break a first run.
     */
    @Test
    @DisplayName("the quickstart keeps the details a first run depends on")
    void quickstartKeepsFirstRunDetails() throws IOException {
        String page = read("quickstart.html");
        assertThat(page).contains("autoReceive: <span class=\"k\">true</span>");
        assertThat(page).contains("<span class=\"s\">'chat-text'</span>");
        assertThat(page).contains("EventMessage.EventType.CHAT_TEXT");
        assertThat(page).contains("/channels/api-access");
        // The npm package is not published; the page must not tell anyone to install it.
        assertThat(page).doesNotContain("npm i @messaging-platform").doesNotContain("npm install @messaging-platform");
    }
}
