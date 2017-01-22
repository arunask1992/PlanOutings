var flock = require('flockos');
var config = require('./config.js');
var express = require('express');
var fs = require('fs');
var mysql = require("mysql");
var request = require('request');
var path = require('path');
var cheerio = require('cheerio');
var async = require("async");
var cron = require('node-schedule');
var groupArray = require('group-array');
var moment = require('moment');
flock.setAppId(config.appId);
flock.setAppSecret(config.appSecret);

var app = express();
app.locals.moment = moment;
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
function loadConfiguration(groupId) {
    con.query('SELECT * from configuration WHERE groupId=?', [groupId], function (err, response) {
        if (err) throw err;
        else if (response.length > 0) {
            configuration = response[0];
        }
        return configuration;
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
function checkTime(){
    var date=new Date();
    var event_id,participant_id,location,createdBy,venue_id,createdBy_name;
    con.query('Select * from events',function(err,rows){
        if(err) throw err;
        if(rows.length>0)
        {
            for(var i=0;i<rows.length;i++)
            {
                if(moment(rows[i].time).diff(moment(),'minutes')==60)
                {
                    event_id=rows[i].event_id;
                    location=rows[i].location;
                    createdBy=rows[i].createdBy;
                    createdBy_name=rows[i].createdBy_name;
                    event_type=rows[i].event_type;
                    venue_id=rows[i].venue_id;
                    con.query('select * from event_participants where event_id=?',event_id,function(err,res){
                        console.log(err);
                        for(var j=0;j<res.length;j++)
                        {
                            participant_id=res[j].participant_id;
                            console.log(participant_id);
                            flock.callMethod('chat.sendMessage',config.botToken,{
                                    to:participant_id,
                                    attachments:[{
                                        title: "Invitation",
                                        description: "Event Invitation",
                                        views: {
                                            flockml:'<flockml>This is to remind you that the event '+event_type+' at <a href="https://foursquare.com/v/'+venue_id+'">'+location+'</a> for which you were invited by <user userId="'+createdBy+'">'+createdBy_name+'</user> will take place in an hour. '
                                        },
                                        buttons:[{
                                            name:'View',
                                            action:{type:'openWidget',desktopType:'sidebar',mobileType:'sidebar',url:'https://bacccc68.ngrok.io/eventBar'},
                                            id:'view',

                                        }]
                                    }]

                                }
                                ,function(err,response){
                                    if(err) console.log(err);
                                });
                        }
                    });
                }
            }
        }
    });
}
checkTime();
var cronJob = cron.scheduleJob("00 *  * * *", function(){
    checkTime();

});

function sendReminderForNonAdhocOutings() {
    var date = new Date();
    const LONG_SINCE_LAST_OUTING_MESSAGE = 'Its very long since you had your last outing, check out what you can try this time';
    const OUTING_COMPLETE_MESSAGE = 'Well the outing went good, but uploading pics in this group helps me keep it safe for future memories.. not just memories you can use me to keep track of bills too';
    var event_id, participant_id, location, createdBy, venue_id, createdBy_name;
    con.query('Select * from groupActivities', function (err, rows) {
        if (err) throw err;
        if (rows.length > 0) {
            for (var i = 0; i < rows.length; i++) {
                configuration = loadConfiguration(rows[i].groupId);
                if (moment().diff(moment(rows[i].lastReceivedMessageTime), 'days') == 23 && !!configuration && (configuration['outingFrequency'] == 1 || configuration['outingFrequency'] == 2)) {
                    var options = {
                        uri: configuration['incomingHookUrl'],
                        method: 'POST',
                        json: {
                            "text": LONG_SINCE_LAST_OUTING_MESSAGE,
                            "attachments": [
                                {
                                    "title": "You could try awesome food at some of these locations",
                                    "description": "Bringing you some of the best places near you..",
                                    "views": {
                                        "widget": {"src": config.siteAddress + '/food', height: 400}
                                    }
                                },
                                {
                                    "title": "Movies showing around you",
                                    "description": "Well, why dont you folks try one of these movies now ??",
                                    "views": {
                                        "widget": {"src": config.siteAddress + '/movies', height: 400}
                                    }
                                }
                                ]
                        }
                    };


                    request(options, function (error, response, body) {
                        if (!error && response.statusCode == 200) {
                            console.log('Posted'); // Print the shortened url.
                        }
                    });
                } else if (moment().diff(moment(rows[i].lastReceivedMessageTime), 'minutes') >= 30) {
                    var options = {
                        uri: configuration['incomingHookUrl'],
                        method: 'POST',
                        json: {
                            "text": OUTING_COMPLETE_MESSAGE,
                        }
                    };


                    request(options, function (error, response, body) {
                        if (!error && response.statusCode == 200) {
                            console.log('Posted complete message'); // Print the shortened url.
                        }
                    });
                }
            }
        }
    });
}
sendReminderForNonAdhocOutings();
var remindOuting = cron.scheduleJob("00 * * * *", function () {
    sendReminderForNonAdhocOutings();
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
                        var foodWidgetOptions = {
                            uri: configuration['incomingHookUrl'],
                            method: 'POST',
                            json: {
                                "text": FIRST_TIME_INSTALL_MESSAGE,
                                "attachments": [
                                    {
                                        "title": "You could try awesome food at some of these locations",
                                        "description": "Bringing you some of the best places near you..",
                                        "views": {
                                            "widget": {"src": config.siteAddress + '/food', height: 400}
                                        }
                                    }
                                    // {
                                    //     "title": "Movies showing around you",
                                    //     "description": "Well, why dont you folks try one of these movies now ??",
                                    //     "views": {
                                    //         "widget": {"src": config.siteAddress + '/movies', height: 400}
                                    //     }
                                    // }
                                    ]
                            }
                        };


                        request(foodWidgetOptions, function (error, response, body) {
                            if (!error && response.statusCode == 200) {
                                console.log('Posted'); // Print the shortened url.
                            }
                        });
                        var moviesWidgetOptions = {
                            uri: configuration['incomingHookUrl'],
                            method: 'POST',
                            json: {
                                "text": 'Not just food sometimes movies could do the magic too !!',
                                "attachments": [
                                    {
                                        "title": "Movies showing around you",
                                        "description": "Well, why dont you folks try one of these movies now ??",
                                        "views": {
                                            "widget": {"src": config.siteAddress + '/movies', height: 400}
                                        }
                                    }
                                ]
                            }
                        };


                        request(moviesWidgetOptions, function (error, response, body) {
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

app.get('/food',function(req,res){
    var token = req.get('x-flock-event-token') || req.query.flockEventToken;
    if (token) {
        var payload = flock.events.verifyToken(token);
        if (!payload) {
            console.log('Invalid event token', token);
            res.sendStatus(403);
            return;
        }
        res.locals.eventTokenPayload = payload;
        res.render(path.join(__dirname+'/food'),{userId:payload.userId});
    }});

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
    var link,movies=[],title;
    url="https://www.ticketnew.com/"+city+'/movies';
    console.log(url);
    request(url, function(error, response, html){

        if(!error && response.statusCode==200){
            var $ = cheerio.load(html);
            var mainClass=$('.theatre_sections');
            for(var i=0;i<mainClass.length;i++)
            {
                console.log(mainClass.length);
                link=mainClass.eq(i).first().find('a').attr('href')+'/C/chennai';
                link=link.replace('Release-Date','Online-Advance-Booking')
                movies.push({
                    link: link,
                });

            }
            console.log(movies);
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
                    if($$('#movies-date-container').length>0)
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
app.get('/addTask',function(req,res){
    var userTask = { userId: req.query.userId, task: req.query.task, dueOn: req.query.date };

    con.query('INSERT INTO todo SET ?', userTask, function(err,response){
        if(err) throw err;
        else
        {
            con.query('SELECT * FROM todo where userId=?',[userTask.userId],function(err,rows){
                checkDay();
                jrows=JSON.stringify(rows);
                res.render(path.join(__dirname + '/todo'),{userId:userTask.userId,rows:jrows});
            });

        }
    });
});
// viewed at http://localhost:8080
app.get('/',function(req, res) {
    var token = req.get('x-flock-event-token') || req.query.flockEventToken;
    if (token) {
        var payload = flock.events.verifyToken(token);
        if (!payload) {
            console.log('Invalid event token', token);
            res.sendStatus(403);
            return;
        }
        res.locals.eventTokenPayload = payload;
        con.query('SELECT * FROM todo where userId=?',[payload.userId],function(err,rows){
            jrows=JSON.stringify(rows);
            res.render(path.join(__dirname + '/todo'),{userId:payload.userId,rows:jrows});
        });
    }
    else
        res.sendStatus(403)
});

app.get('/eventBar',function(req,res){
    var token = req.get('x-flock-event-token') || req.query.flockEventToken;
    var userName="";
    if (token) {
        var payload = flock.events.verifyToken(token);
        if (!payload) {
            console.log('Invalid event token', token);
            res.sendStatus(403);
            return;
        }
        res.locals.eventTokenPayload = payload;
        con.query('select * from events,event_participants where events.event_id=event_participants.event_id and (events.createdBy=? or event_participants.participant_id=?) order by events.event_id',[payload.userId,payload.userId],function(err,res1){
            if(!err)
            {
                res1=groupArray(res1,'event_id');
                res1=JSON.stringify(res1);
                userName=JSON.parse(req.query.flockEvent).userName;
                console.log(userName);
                res.render(path.join(__dirname + '/event_organizer'),{userId:payload.userId,username:userName,rows:res1});
            }
        })

    }
});
app.get('/getContacts',function(req,res){
    var userId=req.query.userId;
    console.log(userId);
    con.query('SELECT token from tokens where uid=?', userId, function(err,res1){
        if(!err)
        {
            console.log('nice');
            var token=res1['0'].token;
            flock.callMethod('roster.listContacts',token,{},function(error,response){
                if(!error)
                    res.send(response);
                else
                    console.log(error);
            });
        }
    });
});
app.get('/delete',function(req,res){
    var event_id=req.query.event_id;
    console.log(event_id);
    var user_id=req.query.user_id;
    var username=req.query.username;
    var date,location,venue_id,createdBy,event_type;
    con.query('Select * from events where event_id=?',event_id,function(error,response){
        if(error) console.log(error);
        else
        {
            event_type=response[0].event_type;
            location=response[0].location;
            venue_id=response[0].venue_id;
            date=response.time;
            date=moment(date).format("dddd, MMMM Do YYYY, h:mm:ss a");
            username=response[0].createdBy_name;
            createdBy=response[0].createdBy;
            console.log(user_id);
            if(createdBy===user_id)
            {
                console.log('delete admin');
                con.query('select participant_id from event_participants where event_id=?',event_id,function(err,response){
                    if(err) console.log(err);
                    else
                    {
                        console.log(response);
                        for(var i=0;i<response.length;i++){
                            console.log('hello');
                            console.log(response[i]);
                            flock.callMethod('chat.sendMessage',config.botToken,{
                                to:response[i].participant_id,
                                //text: 'You have been invited for '+event_type+' at '+location+' by '+username,
                                attachments:[{
                                    title: "Cancellation of Event",
                                    description: "Event cancellation",
                                    views: {
                                        flockml:'<flockml>This is to inform you that the event plan: '+event_type+' at <a href="https://foursquare.com/v/'+venue_id+'">'+location+'</a> created by <user userId="'+user_id+'">'+username+'</user> on '+date+' is cancelled due to some unavoidable reasons.'
                                    },
                                    buttons:[{
                                        name:'View',
                                        action:{type:'openWidget',desktopType:'modal',mobileType:'sidebar',url:'https://bacccc68.ngrok.io/eventBar'},
                                        id:'view',

                                    }]
                                }]

                            },function(error,response)
                            {
                                if(!error)
                                    console.log(response);
                                else
                                    console.log(error);
                            });
                        }
                        con.query('delete from events where event_id=?',event_id,function(error,res2){
                            if(error) console.log(error);
                            else
                            {
                                console.log(res2);
                                res.send('done');
                                /*con.query('select * from events,event_participants where events.event_id=event_participants.event_id and (events.createdBy=? or event_participants.participant_id=?) order by events.event_id',[user_id,user_id],function(err,res1){
                                 if(!err)
                                 {
                                 res1=groupArray(res1,'event_id');
                                 res1=JSON.stringify(res1);
                                 res.render(path.join(__dirname + '/event_organizer'),{userId:user_id,username:username,rows:res1,deleted:'success'});
                                 }
                                 });*/
                            }
                        });
                    }
                })
            }
            else
            {
                flock.callMethod('chat.sendMessage',config.botToken,{
                    to:createdBy,
                    //text: 'You have been invited for '+event_type+' at '+location+' by '+username,
                    attachments:[{
                        title: "Decline event invitation",
                        description: "",
                        views: {
                            flockml:'<flockml>This is to inform you that <user userId="'+user_id+'">'+username+'</user>'+event_type+' at <a href="https://foursquare.com/v/'+venue_id+'">'+location+'</a> created by you on '+date+' due to some unavoidable reasons.'
                        },
                        buttons:[{
                            name:'View',
                            action:{type:'openWidget',desktopType:'modal',mobileType:'sidebar',url:'https://bacccc68.ngrok.io/eventBar'},
                            id:'view',

                        }]
                    }]

                },function(error,response)
                {
                    if(!error)
                    {
                        con.query('delete from event_participants where participant_id=?',user_id,function(err,resD){
                            if(err) console.log(err);
                            else
                            {
                                con.query('select * from events,event_participants where events.event_id=event_participants.event_id and (events.createdBy=? or event_participants.participant_id=?) order by events.event_id',[user_id,user_id],function(err,res1){
                                    if(!err)
                                    {
                                        res1=groupArray(res1,'event_id');
                                        res1=JSON.stringify(res1);
                                        res.render(path.join(__dirname + '/event_organizer'),{userId:user_id,username:username,rows:res1,deleted:'success'});
                                    }
                                });
                            }
                        });
                    }
                    else
                        console.log(error);
                });
            }
        }
    });

});
app.post('/addEvent',function(req,res){
    var username='';
    var event_type=req.body.eventType;
    var participants=JSON.parse(req.body.participants_id);
    var date=req.body.date;
    var venue_id=req.body.venue_id;
    var location=req.body.location;
    var userId=req.body.userId;
    var participant,token;
    var username=req.body.username;
    var events={event_type:event_type,location:location,venue_id:venue_id,createdBy:userId,time:date,createdBy_name:username}
    con.query('INSERT into events set ?',events,function(error,response){
        if(!error)
        {
            console.log('event added');
            var event_id=response.insertId;
            participants=participants.map(function(val){
                participant={event_id:event_id,participant_id:val.participant_id,participant_name:val.participant_name};
                con.query('SELECT token from tokens where uid=?', userId, function(err,res1){
                    if(!err)
                    {
                        token=res1['0'].token;
                        console.log(token);
                    }});
                con.query('INSERT into event_participants set ?',participant,function(error,response)
                {
                    if(!error)
                    {
                        date=moment(date).format("dddd, MMM YYYY, h:mm:ss a");
                        flock.callMethod('chat.sendMessage',token,
                            {
                                to:val.participant_id,
                                //text: 'You have been invited for '+event_type+' at '+location+' by '+username,
                                attachments:[{
                                    title: "Invitation",
                                    description: "",
                                    views: {
                                        flockml:'<flockml>You have been invited for '+event_type+' at <a href="https://foursquare.com/v/'+venue_id+'">'+location+'</a> by <user userId="'+userId+'">'+username+'</user> on '+date
                                    },
                                    buttons:[{
                                        name:'View',
                                        action:{type:'openWidget',desktopType:'modal',mobileType:'sidebar',url:'https://bacccc68.ngrok.io/eventBar'},
                                        id:'view',

                                    }]
                                }]

                            },function(error,response)
                            {
                                if(!error)
                                    console.log(response);
                                else
                                    console.log(error);
                            });
                        con.query('select * from events,event_participants where events.event_id=event_participants.event_id and (events.createdBy=? or event_participants.participant_id=?) order by events.event_id',[userId,userId],function(err,res1){
                            if(!err)
                            {
                                res1=groupArray(res1,'event_id');
                                res1=JSON.stringify(res1);
                                res.render(path.join(__dirname + '/event_organizer'),{userId:userId,username:username,rows:res1,added:'success'});
                            }
                        })
                    }
                    else console.log(error);
                });

            });
        }
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
