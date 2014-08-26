To use this stuff:

1. Start a bootstrap server, `nodejs bootstrap.js`.

2. Run a bootstrap client by pointing firefox or chromium at `usebootstrap.html`.


To compile wrtc, I needed to do this:

1. The `depot_tools` node module had to be in the $PATH, so that it could access the `download_from_google_storage` tool.  The way I did this was to attempt to `npm install` wrtc, it would fail, but in the attempt, it would download `depot_tools`.  I would then add this into the path and try again.  There is probably a more direct way of doing this, but this is what I happened to do, so I'm documenting it here because it worked.

2. In addition to the dependencies listed in wrtc's `README.md`, I had to `apt-get install libxss-dev libgnome-keyring-dev`.

3. I had to have a `JAVA_HOME` set.  I `apt-get install jdk-7-jre`, and then set `export JAVA_HOME=/usr/lib/jvm/java-7-openjdk-amd64`.

4. Now, when I `cd node_modules/wrtc ; npm install`, it would succeed.
