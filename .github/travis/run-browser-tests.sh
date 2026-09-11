#!/bin/bash
# Run the jQuery QUnit browser suite (test/index.html) on CI.
#
# The suite needs two things the Travis node_js image cannot provide itself:
#   * PHP >= 7.4 to serve test/data/*.php. The workers matter: the test fixture
#     test/data/core/dont_return.php never returns, so a single-worker `php -S`
#     deadlocks the whole suite (PHP_CLI_SERVER_WORKERS arrived in 7.4).
#   * A current Chrome plus a current Node to drive it.
# Both come from containers so the Node 0.10 leg that runs `npm test` stays
# untouched.
set -e

ROOT="$( cd "$( dirname "$0" )/../.." && pwd )"
PORT="${QUNIT_PORT:-8123}"
URL="http://127.0.0.1:${PORT}/test/index.html"

cleanup() {
	docker rm -f jquery-test-php > /dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

docker run -d --name jquery-test-php --network host \
	-v "$ROOT":/work -w /work -e PHP_CLI_SERVER_WORKERS=8 \
	php:8.3-cli php -S "127.0.0.1:${PORT}" -t /work

for _ in $( seq 1 60 ); do
	if curl -sf -o /dev/null "$URL"; then
		break
	fi
	sleep 1
done
curl -sf -o /dev/null "$URL" || {
	echo "the test fixture server never came up on ${PORT}"
	docker logs jquery-test-php || true
	exit 1
}

# The official puppeteer image carries Chrome, its shared libraries and a
# matching puppeteer, so nothing is installed at test time.
docker run --rm --network host -v "$ROOT":/work -w /work \
	-e NODE_PATH=/home/pptruser/node_modules --entrypoint bash \
	ghcr.io/puppeteer/puppeteer:22.15.0 \
	-c "node /work/.github/travis/run-qunit.js '${URL}'"
