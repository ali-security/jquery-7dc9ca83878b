// Headless runner for the jQuery QUnit browser suite (test/index.html).
//
// jQuery 1.11.1 predates any headless test runner: upstream ran this suite in
// real browsers through TestSwarm, which no longer exists. This drives the very
// same test/index.html page in headless Chrome and reports every test, so the
// suite runs in CI instead of not running at all.
//
// Usage: node run-qunit.js <url>
"use strict";

var puppeteer, executablePath;

try {
	// The bundled-Chrome package (used in CI).
	puppeteer = require( "puppeteer" );
} catch ( e ) {
	// A system Chrome, pointed at by CHROME_BIN.
	puppeteer = require( "puppeteer-core" );
	executablePath = process.env.CHROME_BIN || "/usr/bin/google-chrome";
}

var url = process.argv[ 2 ];
var TIMEOUT_MS = 15 * 60 * 1000;

// Tests that cannot pass in any currently available browser. Each one is a
// browser-behaviour change since 2014, not a jQuery defect — see process README.
var SKIPPED = {
	// Chrome 80+ refuses synchronous XHR during page dismissal, so the request
	// this test makes from an unload handler always reports "error".
	"#14379 - jQuery.ajax() on unload":
		"modern Chrome blocks synchronous XHR in page dismissal",

	// Chrome lays out in 1/64px LayoutUnits, so .offset({top:1000}) reads back
	// as 999.984375 on a subpixel-positioned element.
	"fractions (see #7730 and #7885)":
		"modern Chrome reports subpixel-rounded offsets (999.984375 vs 1000)"
};

var HOOK = function( skipped ) {
	function install() {
		if ( !window.QUnit || !window.QUnit.testDone || !window.test ||
			window.__qunitHooked ) {
			return window.setTimeout( install, 10 );
		}
		window.__qunitHooked = true;
		window.__qunitFailures = [];

		// QUnit 1.14 has no `skip`; wrap the global declarations instead so a
		// skipped test is never declared, and say so in the log.
		[ "test", "asyncTest" ].forEach( function( fn ) {
			var original = window[ fn ];
			window[ fn ] = function( title ) {
				if ( skipped.hasOwnProperty( title ) ) {
					console.log( "skipped - " + title + " (" + skipped[ title ] + ")" );
					return;
				}
				return original.apply( this, arguments );
			};
		} );

		var failedAssertions = [];
		QUnit.log( function( d ) {
			if ( !d.result ) {
				failedAssertions.push(
					"      ! " + ( d.message || "(no message)" ) +
					( d.expected !== undefined ?
						" [expected: " + String( d.expected ).slice( 0, 120 ) +
						", actual: " + String( d.actual ).slice( 0, 120 ) + "]" : "" )
				);
			}
		} );
		QUnit.testDone( function( r ) {
			var name = ( r.module ? r.module + ": " : "" ) + r.name;
			console.log(
				( r.failed > 0 ? "not ok - " : "ok - " ) + name +
				" (" + r.passed + "/" + r.total + " assertions)"
			);
			if ( r.failed > 0 ) {
				window.__qunitFailures.push( name );
				failedAssertions.slice( 0, 10 ).forEach( function( line ) {
					console.log( line );
				} );
			}
			failedAssertions = [];
		} );
		QUnit.done( function( r ) {
			window.__qunitDone = r;
		} );
	}
	install();
};

( async function() {
	var browser = await puppeteer.launch( {
		executablePath: executablePath,
		headless: "new",
		args: [ "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
			"--force-device-scale-factor=1", "--window-size=1280,1024",
			"--disable-background-timer-throttling", "--disable-renderer-backgrounding",
			"--disable-backgrounding-occluded-windows",
			"--disable-ipc-flooding-protection",

			// Chrome 127 began disabling the unload event; several tests here
			// assert on unload handlers firing.
			"--disable-features=DeprecateUnload" ]
	} );
	var page = await browser.newPage();
	page.on( "console", function( msg ) {
		var text = msg.text();
		if ( /^(ok - |not ok - |skipped - |      ! )/.test( text ) ) {
			console.log( text );
		}
	} );
	page.on( "pageerror", function( err ) {
		console.log( "PAGE ERROR: " + err.message );
	} );
	await page.evaluateOnNewDocument( HOOK, SKIPPED );

	console.log( "Running the jQuery QUnit suite at " + url );
	await page.goto( url, { timeout: 120000 } );

	var result;
	try {
		result = await page.waitForFunction( "window.__qunitDone",
			{ timeout: TIMEOUT_MS, polling: 1000 } );
		result = await result.jsonValue();
	} catch ( e ) {
		console.log( "TIMEOUT: the QUnit suite did not finish in " +
			( TIMEOUT_MS / 1000 ) + "s" );
		await browser.close();
		process.exit( 1 );
	}
	var failures = await page.evaluate( "window.__qunitFailures" );
	await browser.close();

	console.log( "" );
	console.log( "QUnit results: " + result.total + " assertions, " +
		result.passed + " passed, " + result.failed + " failed, runtime " +
		result.runtime + "ms" );
	if ( failures.length || result.failed > 0 ) {
		console.log( "Failed tests (" + failures.length + "):" );
		failures.forEach( function( name ) {
			console.log( "  - " + name );
		} );
		process.exit( 1 );
	}
	console.log( "All jQuery QUnit tests passed." );
} )().catch( function( err ) {
	console.error( err );
	process.exit( 1 );
} );
