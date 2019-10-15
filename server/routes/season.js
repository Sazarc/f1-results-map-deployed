var express = require('express');
var router = express.Router();
const axios = require('axios');

const redis = require('redis');
const redisClient = redis.createClient(6380, process.env.REDISCACHEHOSTNAME,
    {auth_pass: process.env.REDISCACHEKEY, tls: {servername: process.env.REDISCACHEHOSTNAME}});
const redisTime = 1800; // in seconds

const azurestorage = require('azure-storage');
const containerName = "f1-db";
blobService = azurestorage.createBlobService();

/* GET users listing. */
router.get('/', async function(req, res, next) {
    // check for cache

    checkStorages('seasons').then((result) => {
        if(result){
            res.status(200).json(cached);
        }
    }).catch((e) => {
        axios.get("http://ergast.com/api/f1/seasons.json?limit=200")
            .then((response) => {
                const rsp = response.data.MRData.SeasonTable.Seasons;
                const ret = {seasons: []};
                for (let x = 0; x < rsp.length; x++) {
                    ret.seasons.push(parseInt(rsp[x].season));
                }
                // reverse order the season, latest season first
                ret.seasons.reverse();
                // put into cache
                storeNew('seasons', JSON.stringify(ret));
                res.status(200).json(ret);
            }).catch((e) => { console.log("no seasons"); } )
    });
});

async function checkStorages(key){
    return new Promise((resolve, reject) => {
        redisClient.get(key, (err, result) => {
            // If that key exist in Redis store
            if (result) {
                resolve(JSON.parse(result));
            } else { // Key does not exist in Redis store
                blobService.getBlobToText(containerName, key, (err, result) => {
                    if (err) {
                        reject("blob no existo");
                    } else {
                        redisClient.setex(key, redisTime, result);
                        resolve(JSON.parse(result));
                    }
                });
                //
            }
        });
    })
}

function storeNew(key, toStore){
    blobService.createBlockBlobFromText(containerName, key, toStore, err => {
        if (err) {
            console.log(err);
        } else {
            console.log(`Text "${key}" is written to blob storage`);
        }
    });
    redisClient.setex(key, redisTime, toStore);
}

module.exports = router;
