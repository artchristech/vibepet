#!/bin/sh
# copy the real renderer into the site as a scripted demo
cd "$(dirname "$0")"
cp ../renderer/app.js ../renderer/style.css demo/
sed 's#<script src="app.js"></script>#<script src="mock.js"></script><script src="app.js"></script>#; s#connect-src .none.#connect-src '"'"'none'"'"'#' ../renderer/index.html > demo/index.html
cp ../build/icon.png ../build/pet.png .
