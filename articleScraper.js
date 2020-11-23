const rp = require('request-promise');
const $ = require('cheerio');

var fs = require('fs');
const { text } = require('express');

/* 
Takes in a blog article url (supplied by website's user) and scrapes the article for
Amazon affiliate links. It returns an array of affiliate links to app.js.
*/

const recursiveChildrenText = function(linkObject, text) {

    if (linkObject.children && linkObject.children.length > 0) {
        for (let i = 0; i < linkObject.children.length; i++) {
            console.log(linkObject.children[i]);
            const accumulator = linkObject.children[i].data || text;
            const newText = recursiveChildrenText(linkObject.children[i], accumulator);
            if (newText !== text) {
                text = `${text} ${newText}`;
            }
        }
    }
  
    return text;
}

const extractAhrefAndText = function(linkObject) {     //linkObject is: $('a', html)[i]

    var ahref;
    var urlText;

    // for viewing the object of a specific link 
    if (linkObject.attribs.href === "https://amzn.to/2QpoeTa") {
        console.log(linkObject);
    }

    if (!linkObject.children.length) {
        // malformed URLs?
        console.log("Weird URL with no children:", linkObject);
    } else if (linkObject.children[0].name === 'img') {
        // image link - use filepath for text
        ahref = linkObject.children[0].parent.attribs.href;

        if (linkObject.children[0].attribs["data-lazy-src"]) {
            urlText = linkObject.children[0].attribs["data-lazy-src"];
        } else if (linkObject.children[0].attribs.src) {
            urlText = linkObject.children[0].attribs.src;
        } else {
            urlText = "Image with affiliate link exists, but filepath could not be retrieved";
        }
    } else if (linkObject.children[0].name === 'span') {
        // for amazon button case
        ahref = linkObject.attribs.href;
        urlText = "Text could not be retrieved, class: " + linkObject.children[0].attribs["class"];
    } else if (linkObject.children.length == 1) {
        // bog standard text link
        // for text links - use a href text for text
        ahref = linkObject.attribs.href;
        urlText = linkObject.children[0].data;
    } else if (linkObject.children.length > 1) {
        // for links with bolding, spans, etc, attempt to gather what text we can out of them
        // by digging recursively into the children 
        ahref = linkObject.attribs.href;
        urlText = recursiveChildrenText(linkObject, '');
    } else {
        // for text links - use a href text for text
        ahref = linkObject.attribs.href;
        urlText = linkObject.children[0].data;
    }

    //if urlText never got retrieved...
    if (!urlText) {
        urlText = "Link exists, but text could not be retrieved";
    }

    let extracted = {
        ahref: ahref,
        urlText: urlText,
    }

    return extracted;
}

async function articleScraper(url) {
    try {
        let html = await rp(url);

        const urls = [];

        var shortenedExp = /(https?:\/\/(.+?\.)?(amzn.to)(\/[A-Za-z0-9\-\._~:\/\?#\[\]@!$&'\(\)\*\+,;\=]*)?)/;
    
        var urlsCount = $(html).find('a').length;
        //console.log('Found ' + urlsCount + ' URLs');
        // we now have ALL the urls, whether they're affiliate links or not 
        // now check each one to see if it's an affiliate link, and if it is, push it to urls 

        for (let i = 0; i < urlsCount; i++) {
            //console.log("\nEVALUATING URL #", i);
            let extracted = extractAhrefAndText($('a', html)[i]); // object with url and user-readable link text 
    
    
            // if we have an href, look for the tag or the amzn.to/ASIN format
            if (extracted.ahref) {
    
                // if it has 'tag=', we are going to assume it's an affiliate link
                let containsTag = extracted.ahref.includes('tag=');
    
                // if it does not have 'tag=', see if it is a shortened URL 
                let shortened = shortenedExp.test(extracted.ahref);
    
                /* 
                console.log(
                    "URL REPORT:\n" +
                    extracted.ahref + "\n" +
                    '-- Shortened: ' + shortened + "\n" +
                    '-- Contains tag: ' + containsTag
                    );
                */
                // a url gets to go into the array if it either has a tag or matches the expression 
                if (containsTag || shortened) {
                    let articleURLData = {
                        url: extracted.ahref,
                        urlText: extracted.urlText
                    };
                    urls.push(articleURLData);
                } else {
                    //console.log("This is not an Amazon URL:", extracted.ahref);
                }
            } else {
                console.log("This URL does not have an ahref property:", extracted);
            }
        }

        return urls;
    } catch(err) {
        console.log("Get HTML failed", err);
    }
    return [];
};

module.exports = articleScraper;