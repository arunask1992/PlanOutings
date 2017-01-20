var flock = require('flockos');
var config = require('./config.js');
var express = require('express');
var fs = require('fs');
var mysql = require("mysql");
var request = require('request');
var path = require('path');

flock.setAppId(config.appId);
flock.setAppSecret(config.appSecret);

var app = express();
app.set('view engine','ejs');
var bodyParser = require('body-parser');
app.use(bodyParser.json()); // support json encoded bodies
app.use(bodyParser.urlencoded({ extended: true }));

// Listen for events on /events, and verify event tokens using the token verifier.
app.use(flock.events.tokenVerifier);
app.post('/events', flock.events.listener);
var con = mysql.createConnection({
    host: config.mysqlHost,
    user: config.mysqlUser,
    password: config.mysqlPassword,
    database: config.mysqlDatabase
});
con.connect(function(err){
    if(err){
        console.log('Error connecting to Db');
        return;
    }
    console.log('Connection established');
});

var outingTypes;
con.query('SELECT * from outingFrequency', function(err,response){
   if(err) throw err;
    else {
       outingTypes = JSON.stringify(response);
   }
});
// save tokens on app.install
flock.events.on('app.install', function (event) {
    // tokens[event.userId] = event.token;
    var userTokenData = { uid: event.userId, token: event.token};

    con.query('INSERT INTO tokens SET ?', userTokenData, function(err,response){
        if(err) throw err;
        else
        {
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

app.get('/configure',function(req, res) {
    var token = req.get('x-flock-validation-token') || req.query.flockValidationToken;
    var tokenForRequest;
    if (token) {
        var payload = flock.events.verifyToken(token);
        if (!payload) {
            console.log('Invalid event token', token);
            res.sendStatus(403);
            return;
        }


        con.query('SELECT token from tokens WHERE uid=? limit 1', payload.userId, function(err,response){
            if(err) throw err;
            else
            {
                tokenForRequest = response[0]['token'];
                flock.callMethod('groups.list', tokenForRequest,
                    {
                        token: tokenForRequest
                    },function(error,response)
                    {
                        if(!error){
                            res.render(path.join(__dirname + '/configure'),{userId:payload.userId, token: tokenForRequest, groups: response, outingTypes: outingTypes});
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

app.post('/configure', function(req, res){
   console.log(req.body);
    var data = req.body;
    con.query('SELECT * FROM configuration WHERE userId=?',[data.userId], function(err, response){
        if(err) throw err;
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
app.use(function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-APP-TOKEN");
    next();
});

// exit handling -- save tokens in token.js before leaving
process.on('SIGINT', process.exit);
process.on('SIGTERM', process.exit);
