const express = require('express');
const app = express();
const server = require('http').Server(app);
const port = process.env.PORT || 3000;
const articleScraper = require('./articleScraper');
var fs = require('fs');
const io = require('socket.io')(server);
const path = require('path');
const amazonPaapi = require('amazon-paapi');
let uu = require('url-unshort')();
let linksProcessed = 0;
let scrapedUrlsObj = {};
let urlCache = {};
let asinCache = {};
let connections = [];
let stopSignalSent = false;

server.listen(port, () => console.log(`Amazin' Link Checker app listening on port ${port}!`))

function getItemErrorName(errMsg) {
    let returnStr = "";
    if (errMsg === "InvalidParameterValue") {
        returnStr = "ITEM NOT IN API BUT MAY EXIST - check manually!";
    } else if (errMsg === "CommerceService.ItemNotAccessible") {
        returnStr = "DOG PAGE - fix this link!";
    } else {
        //uncaughtError
        returnStr = "Error retrieving item - check manually!";
    }
    return returnStr;
}

function sendToFront(processedURLData, linksProcessed, scrapeInProgress, id) {
    io.to(id).emit('serverDataReceived', processedURLData, linksProcessed, scrapeInProgress);
}

function sendScrapedURLCount(count) {
    io.emit('urlsScraped', count);
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function *getBatch(commonParameters, requestParameters) {
    let index = 0;
    let asins = requestParameters.ItemIds;

    while (index < asins.length) {
      const endIndex = index + 10 < asins.length ? index + 10 : asins.length;
      const chunk = asins.slice(index, endIndex);
      const newRequestParameters = { ...requestParameters, ...{ ItemIds: chunk }};
      console.log(newRequestParameters)
      try {
        let result = await amazonPaapi.GetItems(commonParameters, newRequestParameters);
        await sleep(5000);
        index += chunk.length;
        yield result;
      } catch(err) {
          console.log(err);
      }
    }
}

function buildScrapedURLsObject(urls) {
    const scrapedUrlsObj = {};
    urls.forEach((urlData) => {
        scrapedUrlsObj[urlData.url] = {
            urlText: urlData.urlText, // we have this from the scrape
            itemName: 'Processing...', // product title from amazon
            tag: 'Tag coming...', //urlCache[urlData.url].tag, // myassociateid-20
            url: urlData.url, // http://amzn.to/1234XYZ or similar 
            validOnAmazon: 'Processing...' 
        }
    });
    return scrapedUrlsObj;
}

async function getUniqueASINs(urls) {
    /* Build an array of ASINs by processing each URL */
    // first filter out the bad ones
    urls.filter(u => u !== null && u !== undefined);

    let asins = await getAsins(urls);
    let uniqueAsins = [...new Set(asins)];
    return uniqueAsins;
}

function updateFromEndWithProgress(urls, socketID) {
    // now the asin cache is filled in, so update the urls in the scrapedUrls object
    linksProcessed = 0;
    urls.forEach((urlData) => {
        linksProcessed+=1;
        if (!asinCache[urlCache[urlData.url].asin]) {
            console.log("*** THIS URL / ASIN NOT IN ASINCACHE OBJECT ***");
            console.log(urlData);
            console.log(asinCache);

            scrapedUrlsObj[urlData.url].urlText = urlData.urlText;
            scrapedUrlsObj[urlData.url].itemName = 'No item name found', // product title from amazon
            scrapedUrlsObj[urlData.url].tag = urlCache[urlData.url].tag, // myassociateid-20
            scrapedUrlsObj[urlData.url].url = urlData.url, // http://amzn.to/1234XYZ or similar 
            scrapedUrlsObj[urlData.url].validOnAmazon = false // asinCache[ASIN]: true/false 

        } else {
            console.log("This URL is in the asin cache");
            console.log(urlData);

            scrapedUrlsObj[urlData.url].urlText = urlData.urlText;
            scrapedUrlsObj[urlData.url].itemName = asinCache[urlCache[urlData.url].asin] ? asinCache[urlCache[urlData.url].asin].itemName : 'no name found', // product title from amazon
            scrapedUrlsObj[urlData.url].tag = urlCache[urlData.url].tag, // myassociateid-20
            scrapedUrlsObj[urlData.url].url = urlData.url, // http://amzn.to/1234XYZ or similar 
            scrapedUrlsObj[urlData.url].validOnAmazon = asinCache[urlCache[urlData.url].asin].valid // asinCache[ASIN]: true/false 
        }
    });

    // make it an array and send to the front 
    let urlsWithAmazonDataArray = Object.values(scrapedUrlsObj);

    sendToFront(urlsWithAmazonDataArray, linksProcessed, false, socketID);
}

async function contactAmazon(commonParameters, uniqueAsins, urls, socketID) {
    const requestParameters = {
        'ItemIds': uniqueAsins,
        'ItemIdType': 'ASIN',
        'Condition': 'New',
        'Resources': [
            'ItemInfo.Title',
            'Offers.Listings.Price'
        ]
    };

    for await (const res of getBatch(commonParameters, requestParameters)) {
        console.log(new Date());
        let data = res;

        for (let i = 0; i < data.ItemsResult.Items.length; i++) {
            let item = data.ItemsResult.Items[i];
            asinCache[item.ASIN] = {
                valid: true,
                itemName: item.ItemInfo.Title.DisplayValue
            }
        }

        // these ASINs were rejected by Amazon, but the ASIN has to be extracted from the message: 
        /* "Errors": [
            {
            "__type": "com.amazon.paapi5#ErrorData",
            "Code": "InvalidParameterValue",
            "Message": "The ItemId B0077QSLXI provided in the request is invalid."
            }
        ], */

        if (data.Errors) {
            const extractedASINs = data.Errors.map((err) => {
                const regexp = /[a-zA-Z0-9]{10}/;
                const match = err.Message.match(regexp);
                return match ? match[0] : null;
               }).filter(i => i)

            extractedASINs.forEach((asin) => {
                asinCache[asin] = {
                    valid: false,
                    itemName: 'Item not found - check link manually'
                }
            });
        }

        // when this batch of 10 is ready, send it to the front-end 
        updateFromEndWithProgress(urls, socketID);
    }
}

io.on('connection', function(socket) {
    console.log('a user connected: ', socket.id);
    connections.push(socket.id);

    socket.on('disconnect', function(socket) {
        let idx = connections.findIndex(i => socket.id === i);
        connections.splice(idx, 1);
    });

    socket.on('stopSignal', function(socket) {
        stopSignalSent = true;
    })

    socket.on('beginProcessing', async (url, socketID, awsID, awsSecret, awsTag, marketplace) => {

        const commonParameters = {
            'AccessKey': awsID,
            'SecretKey': awsSecret,
            'PartnerTag': awsTag,
            'PartnerType': 'Associates',
            'Marketplace': marketplace 
        };

        console.log("url: ", url);
        console.log("socketID: ", socketID);
        console.log("awsID: ", awsID);
        console.log("awsSecret: ", awsSecret);
        console.log("awsTag: ", awsTag);
        console.log("marketplace: ", marketplace);

        stopSignalSent = false;

        let urls = await articleScraper(url);
        
        sendScrapedURLCount(urls.length);

        /* The scraper returns an array of Amazon affiliate links from the user's blog article .
            This code visits each one and builds an object representing the data on the page, 
            and displays that data to the user.
        */

        // send just the scraped urls to the front, before getting any data from amazon 
        scrapedUrlsObj = buildScrapedURLsObject(urls);
        let scrapedUrlsArray = Object.values(scrapedUrlsObj);
        sendToFront(scrapedUrlsArray, 0, false, socketID); // 0 links processed because this is just the scrape 

        // now extract the unique asins for sending to amazon 
        let uniqueAsins = await getUniqueASINs(urls);

        // now it is ready to interact with amazon server 
        await contactAmazon(commonParameters, uniqueAsins, urls, socketID);
    });
});

app.use(function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});

app.use(express.static(path.join(__dirname, './public')));

app.get('/fetch-static-data', (req, res) => {
    fs.readFile('./results.json', 'utf8', function(err, data) {
        if (err) throw err;
        //io.emit('mandiTest', 'socket stuff: read in some json data!!');
        io.emit('staticDataReceived', JSON.parse(data));
    });
});

async function getAsins(urls) {
    let asins = [];

    for await (let urlData of urls) {

        let data = await extractASINAndTagFromURL(urlData.url);

        // make an entry for it in the cache 
        if (!urlCache[urlData.url]) {
            urlCache[urlData.url] = {
                itemName:"unprocessed",
                validOnAmazon:false,
                asin: data.asin,
                tag: data.tag,
            }
        }

        if (data.asin) {
            asins.push(data.asin);
        } else {
            console.log(urlData.url + " does not have a valid ASIN");
        }
    }

    return asins;

};

async function extractASINAndTagFromURL(url) {
    let asin = '';
    let tag = 'no tag found';

    //console.log("extracting ASIN and Tag from this url: ", url);
    const shortenedMatch = url.match(/http(s?):\/\/amzn.to\/([a-zA-Z0-9]+)/);
    const shortened = shortenedMatch ? shortenedMatch[0] : '';

    if (shortenedMatch) {
        // if this is a shortened URL, we have to figure out where it goes 
        const longURL = await uu.expand(shortened);
            if (longURL) {
                const tagRaw = longURL.match(/(tag=([A-Za-z0-9-]{3,}))/);
                tag = tagRaw[0].replace('tag=','');

                const asinMatch = longURL.match(/\/[A-Z0-9]{4,}\//);
                asin = asinMatch ? asinMatch[0].replace(/\//g, '') : '';
            } else {
                console.log('This url can\'t be expanded');
            }
    } else {
        // it is already a full-length URL
        const tagRaw = url.match(/(tag=([A-Za-z0-9-]{3,}))/);
        tag = tagRaw[0].replace('tag=','');

        const asinMatch = url.match(/\/\w{8,}[A-Z0-9]/);
        let extractedAsin = asinMatch ? asinMatch[0] : '';
        asin = extractedAsin.replace('/', ''); // remove leading slash if exists
    }
    
    return {asin, tag};
}