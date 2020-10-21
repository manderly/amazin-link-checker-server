const rp = require('request-promise');
const $ = require('cheerio');

var fs = require('fs');

/* 
Takes in a blog article url (supplied by website's user) and scrapes the article for
Amazon affiliate links. It returns an array of affiliate links to app.js.
*/

const articleScraper = function (url) {
    console.log("url came in as: ", url);
    return new Promise((resolve, reject) => {
        rp(url)
            .then(function (html) {

                const urls = [];

                var expression = /(https?:\/\/(.+?\.)?(amazon\.com|amzn.to)(\/[A-Za-z0-9\-\._~:\/\?#\[\]@!$&'\(\)\*\+,;\=]*)?)/;

                var urlsCount = $(html).find('a').length;

                // build up the array of amazon links
                for (let i = 0; i < urlsCount; i++) {
                    // we know there are N urls on the page
                    // find each one and determine if it's a text link
                    // (we'll do image links in a later step)
                    // if it's a text link, save the text as urlText
                    // if it's an image, save the img filepath as urlText

                    var ahref;
                    var affiliateLink;
                    var urlText;

                    if ($('a', html)[i].children[0].name === 'img') {
                        // image found - use filepath for text
                        ahref = $('a', html)[i].children[0].parent.attribs.href;

                        if ($('a', html)[i].children[0].attribs["data-lazy-src"]) {
                            urlText = $('a', html)[i].children[0].attribs["data-lazy-src"];
                        } else if ($('a', html)[i].children[0].attribs.src) {
                            urlText = $('a', html)[i].children[0].attribs.src;
                        } else {
                            urlText = "Image with affiliate link exists, but filepath could not be retrieved";
                        }

                        // debug tools:
                        //let fullInfo = $('a', html)[i].children[0].attribs["data-lazy-src"];
                        //console.log(fullInfo); // all the info on this element

                        //let srcInfo = $('a', html)[i].children[0].attribs.src;
                        //console.log(srcInfo); //gets the image source info 

                        //let imgAHref = $('a', html)[i].children[0].parent.attribs.href;
                        //console.log(imgAHref); // gets the image's link target
                    } else {
                        // for text links - use a href text for text
                        ahref = $('a', html)[i].attribs.href;
                        urlText = $('a', html)[i].children[0].data;
                    }

                    //if urlText never got retrieved...
                    if (!urlText) {
                        urlText = "Link exists, but text could not be retrieved";
                    }

                    affiliateLink = expression.test(ahref);
                    if (affiliateLink) {
                        let articleURLData = {
                            url: ahref,
                            urlText: urlText
                        }
                        urls.push(articleURLData);
                    }
                }
                resolve(urls);
            }).catch((err) => {
                console.log(err);
            });
    });
};

module.exports = articleScraper;