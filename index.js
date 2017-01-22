var flock = require('flockos');
var config = require('./config.js');
var express = require('express');
var fs = require('fs');
var mysql = require("mysql");
var request = require('request');
var path = require('path');
var cheerio = require('cheerio');
var async=require("async");
flock.setAppId(config.appId);
flock.setAppSecret(config.appSecret);

var app = express();
app.set('view engine', 'ejs');
var bodyParser = require('body-parser');
app.use(bodyParser.json()); // support json encoded bodies
app.use(bodyParser.urlencoded({extended: true}));
// app.locals.moment = moment;

// Listen for events on /events, and verify event tokens using the token verifier.
app.use(flock.events.tokenVerifier);
app.post('/events', flock.events.listener);
var con = mysql.createConnection({
    host: config.mysqlHost,
    user: config.mysqlUser,
    password: config.mysqlPassword,
    database: config.mysqlDatabase
});
con.connect(function (err) {
    if (err) {
        console.log('Error connecting to Db');
        return;
    }
    console.log('Connection established');
});

var outingTypes;
var configuration;
function loadConfiguration(groupId){
    con.query('SELECT * from configuration WHERE groupId=?',[groupId], function (err, response) {
        if (err) throw err;
        else if(response.length > 0){
            configuration = response[0];
        }
    });
}
con.query('SELECT * from outingFrequency', function (err, response) {
    if (err) throw err;
    else {
        outingTypes = JSON.stringify(response);
    }
});
// save tokens on app.install
flock.events.on('app.install', function (event) {
    // tokens[event.userId] = event.token;
    var userTokenData = {uid: event.userId, token: event.token};

    con.query('INSERT INTO tokens SET ?', userTokenData, function (err, response) {
        if (err) throw err;
        else {
            //Message user and ask for config data
        }
    });
});

// delete tokens on app.uninstall
flock.events.on('app.uninstall', function (event) {
    con.query('DELETE FROM tokens WHERE uid = ?', event.userId, function (error, results, fields) {
        if (error) throw error;
        console.log('deleted ');
    })
});

app.get('/configure', function (req, res) {
    var token = req.get('x-flock-validation-token') || req.query.flockValidationToken;
    var tokenForRequest;
    if (token) {
        var payload = flock.events.verifyToken(token);
        if (!payload) {
            console.log('Invalid event token', token);
            res.sendStatus(403);
            return;
        }


        con.query('SELECT token from tokens WHERE uid=? limit 1', payload.userId, function (err, response) {
            if (err) throw err;
            else {
                tokenForRequest = response[0]['token'];
                flock.callMethod('groups.list', tokenForRequest,
                    {
                        token: tokenForRequest
                    }, function (error, response) {
                        if (!error) {
                            res.render(path.join(__dirname + '/configure'), {
                                userId: payload.userId,
                                token: tokenForRequest,
                                groups: response,
                                outingTypes: outingTypes
                            });
                        }
                        else
                            console.log(error);
                    });
            }
        });

        res.locals.eventTokenPayload = payload;
    }
    else
        res.sendStatus(403)
});
// https://api.flock.co/hooks/sendMessage/a531b436-484a-4e11-8d3a-d4db812cb193
app.post('/callback', function (req, res) {
    var token = req.get('x-flock-validation-token') || req.query.token;
    var currentTimeStamp = require('moment')().format('YYYY-MM-DD HH:mm:ss');
    const FIRST_TIME_INSTALL_MESSAGE = 'Looks like you have installed teamBonding for first time, you can create a new outing by clicking on the side bar. Cheers!!'
    loadConfiguration(req.body.to);
    con.query('SELECT * from groupActivities WHERE groupId=?', req.body.to, function (err, response) {
        if (err) throw err;
        else {
            if (response.length === 0) {
                var data = {groupId: req.body.to, lastReceivedMessageTime: currentTimeStamp};
                con.query('INSERT INTO groupActivities SET ?', data, function (err, response) {
                    if (err) {
                        throw err;
                    } else {
                        var options = {
                            uri: configuration['incomingHookUrl'],
                            method: 'POST',
                            json: {
                                "text": FIRST_TIME_INSTALL_MESSAGE,
                                "attachments": [
                                    {
                                        "title": "Movies showing around you",
                                        "description": "List of movies based on your location",
                                        "views": {
                                            "widget": {"src": config.siteAddress + '/movies', height: 400}
                                        }
                                    }]
                            }
                        };


                        request(options, function (error, response, body) {
                            if (!error && response.statusCode == 200) {
                                console.log('Posted'); // Print the shortened url.
                            }
                        });
                    }
                });

            } else {
                //updating last updated time
                con.query('UPDATE  groupActivities SET lastReceivedMessageTime=? WHERE groupId=?', [currentTimeStamp, req.body.to], function (err, response) {
                    if (err) throw err;
                    else {
                        console.log('Last updated at changed for gid' + req.body.to);
                    }
                });
            }
        }
    });
});
app.get('/food', function (req, res) {
    res.render(path.join(__dirname + '/food'));
});

app.get('/movies', function (req, res) {
    res.render(path.join(__dirname + '/movies'));
});

app.post('/configure', function (req, res) {
    console.log(req.body);
    var data = req.body;
    con.query('SELECT * FROM configuration WHERE userId=?', [data.userId], function (err, response) {
        if (err) throw err;
        else {
            if (response.length == 0) {
                con.query('INSERT INTO configuration SET ?', data, function (err, response) {
                    if (err) {
                        res.render(path.join(__dirname + '/failurePage'), {message: 'Configuration of application was not successful'});
                        throw err;
                    } else {
                        res.render(path.join(__dirname + '/successPage'), {message: 'Configuration of application was successful'});
                    }
                });
            }
            else {
                con.query('UPDATE configuration SET groupId=?,outingFrequency=? where userId=?', [data.groupId, data.outingFrequency, data.userId], function (err, response) {
                    if (err) {
                        res.render(path.join(__dirname + '/failurePage'), {message: 'Configuration of application was not successful'});
                        throw err;
                    } else {
                        res.render(path.join(__dirname + '/successPage'), {message: 'Configuration of application was successful'});
                    }
                })
            }
        }
    });
});


// Start the listener after reading the port from config
var port = config.port || 8080;
app.listen(port, function () {
    console.log('Listening on port: ' + port);
});

app.get('/scrape',function(req,res){
    var city=req.query.city;
    console.log(city);
    var link,movies=[],title;
    url="https://www.ticketnew.com/"+city+'/movies';
    console.log(url);
    request(url, function(error, response, html){

        if(!error && response.statusCode==200){
            var $ = cheerio.load(html);
            var mainClass=$('.theatre_sections');
            for(var i=0;i<mainClass.length;i++)
            {
                link=mainClass.eq(i).first().find('a').attr('href');
                movies.push({
                    link: link,
                });

            }
            res.send(movies);
        }

        else
            throw error;
    });
});
app.get('/download.png',function(req,res){
    res.sendFile(path.join(__dirname + '/download.png'));
});
app.post('/scrapeImage', function (req, res) {
    "use strict";
    let urls = [],movies=[];
    var links=req.body,counter=0;
    for (let y = 0; y < links.length; y++) {
        urls.push(links[y].link);
    }

    function httpGet(url, callback) {
        const options = {
            url :  url,
            json : true
        };
        request(options,
            function(err, res, html) {
                if(html){
                    var $$=cheerio.load(html);
                    let status="";
                    let mainId=$$('#divMoviedetails');
                    let img=$$('.mov_img_b').find('img').attr('src') || $$('.movie-info-image').find('img').attr('src');
                    let movieDetails=mainId.eq(1);
                    let title=$$('span[itemprop="name"]').attr('title')|| $$('.movie_info_b_l_info h3').text();
                    let language=$$('span[itemprop="inLanguage"]').html()|| $$('.sub_til >ul>li').first().text();
                    if($$('#movies-date-container').length)
                        status='Now showing';
                    else
                        status='Coming soon';
                    movies.push({
                        title:title,
                        img:img,
                        language:language,
                        status:status,
                        url:url
                    });
                    callback(err, movies);
                }
            }
        );
    }
    async.map(urls, httpGet, function (err, res1){
        if (err) return console.log(err);
        console.log(movies.length);
        res.send(movies);
    });
});
app.use(function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-APP-TOKEN");
    next();
});



// exit handling -- save tokens in token.js before leaving
process.on('SIGINT', process.exit);
process.on('SIGTERM', process.exit);
