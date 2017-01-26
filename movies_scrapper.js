var exports = module.exports = {};
var mysql = require("mysql");
var common = require('./common.js');
var config = common.config();
var express = require('express');
var fs = require('fs');
var request = require('request');
var path = require('path');
var cheerio = require('cheerio');
var async = require("async");
var moment = require('moment');

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

function persistMovies(obj){
    for(var i=0;i<obj.length;i++)
    {
            let elementToBeInserted = obj[i];
            console.log(elementToBeInserted.title);
            con.query('SELECT * from scrapedMovies where name = ?',elementToBeInserted.title, function(err,res){
                console.log('here ' + res.length);
                if(err) throw err;
                else if(res.length === 0 && !!elementToBeInserted) {
                    var movieImage = !!elementToBeInserted.img ? elementToBeInserted.img : config.siteAddress + '/download.png';
                    var movie = {name: elementToBeInserted.title, language: elementToBeInserted.language, image_url: movieImage, url: elementToBeInserted.url};
                    con.query('INSERT into scrapedMovies set ?', movie, function (error, response) {
                        if (error) throw error;
                        else {
                            console.log('Inserted');
                        }
                    });
                }
                });
    }

}

exports.getContents = function getContents(city)
{
    console.log('Inside');
    request(config.siteAddress + "/scrape?city="+city, function(error, response, body){
        if (!error && response.statusCode == 200) {
            data=JSON.parse(body);
            var options = {
                uri: config.siteAddress + '/scrapeImage',
                method: 'POST',
                json: data
            };
            request(options, function(error, response, body){
                if (!error && response.statusCode == 200) {
                    persistMovies(body);
                }
            });
    }
    });
};

exports.fetchScrapedMovies = function fetchScrapedMovies(callback){
    var response;
    con.query("SELECT * from scrapedMovies where image_url <> 'https://6db78e82.ngrok.io/download.png'",[], function(err,res){
        if(err) throw err;
        else{
            callback(JSON.stringify(res));
        }
    });
};

