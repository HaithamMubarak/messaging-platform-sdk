package com.hmdev.messaging.sdk;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
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
            "apps/mini-games/blockparty/index.html",
            "apps/mini-games/air-hockey/index.html",
            "apps/mini-games/quiz-battle/index.html",
            "apps/mini-games/find-the-liar/index.html",
            "apps/mini-games/reactor/reactor-client.html",
            "apps/pictionary/index.html",
            "apps/chess/index.html",
            "apps/whiteboard/index.html",
            "apps/chat.html");
    // apps/quickshare/quickshare.html is deliberately absent: QuickShare was
    // retired to a noindex redirect at Drop, and a redirect has nothing to
    // unfurl.

    /** Pages that must never be indexed, whether or not robots.txt is fetched. */
    private static final List<String> PRIVATE_PAGES = List.of(
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
        String base = "https://hmdevonline.com/messaging-platform/sdk/";
        Matcher m = Pattern.compile("<loc>([^<]+)</loc>").matcher(read("sitemap.xml"));

        List<String> missing = new ArrayList<>();
        while (m.find()) {
            String loc = m.group(1);
            assertThat(loc).startsWith(base);
            String relative = loc.substring(base.length()).split("\\?")[0];
            if (relative.isEmpty()) relative = "index.html";
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

    @Test
    @DisplayName("no page links to a file that is not in the build")
    void internalLinksResolve() throws IOException {
        Pattern ref = Pattern.compile("(?:href|src)=\"([^\"#][^\"]*)\"");
        List<String> broken = new ArrayList<>();

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

                    Path target = path.startsWith("/")
                            ? STATIC.resolve(path.substring(1))
                            : page.getParent().resolve(path);
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
}
