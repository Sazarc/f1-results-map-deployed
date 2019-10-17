var express = require('express');
const axios = require('axios');
var router = express.Router();
const cache = require('memory-cache');

const redis = require('redis');
const redisClient = redis.createClient(6380, process.env.REDISCACHEHOSTNAME,
    {auth_pass: process.env.REDISCACHEKEY, tls: {servername: process.env.REDISCACHEHOSTNAME}});
const redisTime = 1800; // in seconds

const azurestorage = require('azure-storage');
const containerName = "f1-db";
blobService = azurestorage.createBlobService();

/* GET home page. */
router.get('/', function(req, res, next) {
    //If season query isn't provided respond 400
    if(!req.query.season){
        res.status(400).json({message: "No season is defined"})
    }

    let season = req.query.season;
    let url = "http://ergast.com/api/f1/" + season + "/results.json?limit=500";

    checkStorage(season+'/results').then((results) => {
        checkStorage(season+'/data').then((data) => {
            if(results){
                results = JSON.parse(results);
                data = JSON.parse(data);
                getSeasonResults(season, data.MRData.total, data.MRData.RaceTable.Races, results.MRData.RaceTable.Races).then((seasonResults) => {
                    res.locals.ret = seasonResults;
                    next();
                })
            }
        })
    }).catch(() => {
        axios.get(url).then(async (response) => {
            const rsp = response.data;
            let seasonData = await axios.get("http://ergast.com/api/f1/" + season + ".json").then((response) =>{
                return response.data;
            });
            try{
                // cache response for 30 mins
                storeNew(season+'/results', JSON.stringify(rsp));
                storeNew(season+'/data', JSON.stringify(seasonData));
                //json data to respond to request
                let data = await getSeasonResults(season, parseInt(seasonData.MRData.total), seasonData.MRData.RaceTable.Races, rsp.MRData.RaceTable.Races);
                // store in local response for next to respond
                res.locals.ret = data;
                next();
            }
            catch (e) {
                console.log(e);
            }
        }).catch((error) => {
            res.render('error', {error})
        });
    });
});

// Next to respond to request
router.get('/', function (req, res) {
    res.status(200).json(res.locals.ret);
});

//getResults of the season
function getSeasonResults(season, length, seasonData, seasonResults) {
    let jason = {season: season, length: length, results: []};
    let results = [];
    // let seasonData = await cache.get(season+'data');
    // let seasonResults = await cache.get(season+'results');
    for (let x = 0; x < length; x++) {
        if(x >= seasonResults.length){ // Checking if incomplete season then:
            results.push(getRoundDetails(seasonData[x], x + 1, false));
        }
        else{ // Else proceed as normal
            results.push(getRoundDetails(seasonResults[x], x + 1, true));
        }
    }
    //await for all promises to be complete before returning
    return Promise.all(results).then((values) => {
        jason.results = values;
        return jason;
    });
}

// get the details of each round
async function getRoundDetails(raceData, x, complete){
    let data = {
        round: x,
        raceName: raceData.raceName,
        dateTime: raceData.date + "T" + raceData.time,
        complete: complete,
        circuit: raceData.Circuit.circuitName,
        locality: raceData.Circuit.Location.locality,
        country: raceData.Circuit.Location.country,
        marker: {
            round: x,
            latlng: [raceData.Circuit.Location.lat, raceData.Circuit.Location.long],
            raceName: raceData.raceName,
        }
    };
    if(complete){
        try{
            data.results = await getRoundResults(raceData.Results);
        }
        catch (e) {
            data.results = undefined;
        }
    }
    return data;
}

// get the results of the round with driver flags
async function getRoundResults(results) {
    let flags = [];
    for(let i = 0; i < results.length; i++){
        flags.push(getFlag(results[i].Driver.nationality));
    }
    return Promise.all(flags)
        .then((values) => {
            let arr = [];
            for(let i = 0; i < values.length; i++){
                arr.push({
                    number: results[i].number,
                    position: results[i].position,
                    givenName: results[i].Driver.givenName,
                    familyName: results[i].Driver.familyName,
                    nationality: results[i].Driver.nationality,
                    flag: values[i]
                });
            }
            return arr;
    });
}

// get the flag link based on nationality
function getFlag(nationality){
    let url;
    if(nationality.toLowerCase() === 'dutch'){
        url = "https://restcountries.eu/rest/v2/name/netherlands?fields=flag";
    }
    else if(nationality.toLowerCase() === 'argentine'){
        url = "https://restcountries.eu/rest/v2/name/argentina?fields=flag";
    }
    else if(nationality.toLowerCase() === 'indian'){
        return "https://restcountries.eu/data/ind.svg";
    }
    else if(nationality.toLowerCase() === "rhodesian"){
        return "https://upload.wikimedia.org/wikipedia/commons/0/02/Flag_of_Rhodesia_%281968–1979%29.svg";
    }
    else if(nationality.toLowerCase() === 'east german'){
        return "https://upload.wikimedia.org/wikipedia/commons/a/a1/Flag_of_East_Germany.svg";
    }
    else{
        url = "https://restcountries.eu/rest/v2/demonym/"+nationality+"?fields=flag";
    }

    return checkStorage(nationality.toLowerCase()).then((result) => {
        if(result){
            return result;
        }
    }).catch((e) => {
        return axios.get(url).then((response) => {
            storeNew(nationality.toLowerCase(), response.data[0].flag);
            return (response.data[0].flag);
        }).catch((e) => {
            console.log(`Flag not found: ${nationality}`);
        });
    })
}

async function checkStorage(key){
    return new Promise((resolve, reject) => {
        redisClient.get(key, (err, result) => {
            // If that key exist in Redis store
            if (result) {
                resolve(result);
            } else { // Key does not exist in Redis store
                blobService.getBlobToText(containerName, key, (err, result) => {
                    if (err) {
                        reject("blob no existo");
                    } else {
                        redisClient.setex(key, redisTime, result);
                        resolve(result);
                    }
                });
                //
            }
        });
    })
}

async function storeNew(key, toStore){
    return new Promise((resolve, reject) => {
        blobService.createBlockBlobFromText(containerName, key, toStore, err => {
            if (err) {
                reject(err);
            } else {
                resolve({message: `Text "${key}" is written to blob storage`});
            }
        });
    redisClient.setex(key, redisTime, toStore);
    });
}

module.exports = router;