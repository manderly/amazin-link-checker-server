const express = require('express');
const app = express();
const server = require('http').Server(app);
const port = 3000;
const articleScraper = require('./articleScraper');
var fs = require('fs');
const io = require('socket.io')(server);
const path = require('path');
var amazon = require('amazon-product-api');
let uu = require('url-unshort')();
let urlCache = {};
let connections = [];
let stopSignalSent = false;

server.listen(port, () => console.log(`Amazin' Link Checker app listening on port ${port}!`))

function getItemErrorName(errMsg) {
    let returnStr = "";
    if (errMsg == "AWS.InvalidParameterValue") {
        returnStr = "ITEM NOT IN API BUT MAY EXIST - check manually!";
    } else if (errMsg == "AWS.ECommerceService.ItemNotAccessible") {
        returnStr = "DOG PAGE - fix this link!";
    } else {
        //uncaughtError
        returnStr = "Error retrieving item - check manually!";
    }
    return returnStr;
}

function sendToFront(urlData, results, id) {
    let resultObj = {
        urlText: urlData.urlText,
        itemName: urlCache[urlData.url].itemName,
        tag: urlCache[urlData.url].tag,
        url: urlData.url,
        validOnAmazon: urlCache[urlData.url].validOnAmazon
    };

    results.push(resultObj); // build a results array for file-writing purposes   
    io.to(id).emit('serverDataReceived', resultObj);
}

function sendScrapedURLCount(count) {
    io.emit('urlsScraped', count);
}

io.on('connection', function(socket){
    console.log('a user connected: ', socket.id);
    connections.push(socket.id);

    socket.on('disconnect', function(socket) {
        let idx = connections.findIndex(i => socket.id === i);
        connections.splice(idx, 1);
    });

    socket.on('stopSignal', function(socket) {
        stopSignalSent = true;
    })

    socket.on('beginProcessing', (url, socketID, awsID, awsSecret, awsTag) => {
        console.log(url);
        console.log(socketID);
        console.log(awsID);
        console.log(awsSecret);
        console.log(awsTag);

        stopSignalSent = false;

        articleScraper(url)
        .then(async urls => {
            sendScrapedURLCount(urls.length);
            /* The scraper returns an array of Amazon affiliate links from the user's blog article .
               This code visits each one and builds an object representing the data on the page, 
               and displays that data to the user.
            */
            
            var client = amazon.createClient({
                awsId: awsID, 
                awsSecret: awsSecret, 
                awsTag: awsTag
            });

            let results = []; // we build an array of results to write to a file for offline testing

            /* Build ASIN data object that holds data returned from Amazon */
            await urls.filter(u => u !== null && u !== undefined).forEach(async (urlData, index) => {                  
                // this is either a URL we've seen before or a brand new one
                if (!urlCache[urlData.url]) {
                    setTimeout(async () => {
                        if (connections.findIndex(i => i === socketID) !== -1 && !stopSignalSent) {
                            console.log("connection still live");
                            console.log("NEW URL FOUND:", urlData.url);

                            // make an entry for it in the cache 
                            urlCache[urlData.url] = {
                                itemName:"unprocessed",
                                validOnAmazon:false,
                                asin: '',
                                tag: 'no tag found'
                            }
    
                            // send to amazon to build out urlCache object 
                            client.itemLookup({
                                idType: 'ASIN',
                                itemId: [await extractASINFromURL(urlData.url, index)] //must go to Amazon as array
                            }).then((azonResponse) => {
                                //console.log("Amazon response:");
                                //console.log(azonResponse[0].ItemAttributes[0].ListPrice[0].FormattedPrice[0]);
                                urlCache[urlData.url].validOnAmazon = true;
                                urlCache[urlData.url].itemName = azonResponse[0].ItemAttributes[0].Title[0];
                                sendToFront(urlData, results, socketID);
                            }).catch((err) => { 
                                let errMsg = err.length ? err[0].Error[0].Code : 'elseError';
                                urlCache[urlData.url].itemName = getItemErrorName(errMsg);
                                urlCache[urlData.url].validOnAmazon = false;
                                sendToFront(urlData, results, socketID);
                            });   
                        }
                    }, index * 5000);
            } else {
                // we've already recorded amazon data for this url
                sendToFront(urlData, results, socketID);
            }

            if (results.length === urls.length) {
                //write it to a local file for easy testing without amazon servers 
                const fileContents = JSON.stringify(results);
                fs.writeFile("./results.json", fileContents, (err) => {
                    if (err) {
                        console.error(err);
                        return;
                    }
                    console.log("File created!");
                })
            }
        });
      })
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
        //console.log("Sending JSON data to front-end");
        //res.send(data);
    });
});

async function extractASINFromURL(url, index) {
    /* 
        Some example urls: 

        http://www.amazon.com/VIZIO-M55-C2-55-Inch-Ultra-Smart/dp/B00T63YW38/ref=as_li_ss_tl?s=electronics&ie=UTF8&qid=1460752276&sr=1-2&keywords=vizio+55"&linkCode=sl1&tag=hu15-20&linkId=e2f9cdeebaa790345f213432b01b500a

        https://www.amazon.com/gp/product/B00L8827BI/ref=as_li_tl?ie=UTF8&camp=1789&creative=390957&creativeASIN=B00L8827BI&linkCode=as2&tag=diy07a-20&linkId=GGXKRZCRALWZO2CL

        http://amzn.to/2662MG6
    */

    let asin = '';

    const shortenedMatch = url.match(/http:\/\/amzn.to\/([a-zA-Z0-9]+)/);
    const shortened = shortenedMatch ? shortenedMatch[0] : index;

    if (shortenedMatch) {
        // if this is a shortened URL we have to figure out where it goes 
        const longURL = await uu.expand(shortened);
            if (longURL) {
                console.log(`Original URL is ${longURL}`);

                const tagRaw = longURL.match(/(tag=([A-Za-z0-9-]{3,}))/);
                tag = tagRaw[0].replace('tag=','');
                urlCache[url].tag = tag;

                const asinMatch = longURL.match(/\/[A-Z0-9]{4,}\//);
                asin = asinMatch ? asinMatch[0].replace(/\//g, '') : index;
                //console.log("got this asin from the long url: ", asin);
                return asin;
            } else {
                //console.log('This url can\'t be expanded');
            }
    } else {
        // it's already a long URL 
        const tagRaw = url.match(/(tag=([A-Za-z0-9-]{3,}))/);
        tag = tagRaw[0].replace('tag=','');
        urlCache[url].tag = tag;

        //todo: duplicated code (line 182)
        const asinMatch = url.match(/([A-Z0-9])\w{4,}/);
        asin = asinMatch ? asinMatch[0] : index;
    }
    
    return asin;
}