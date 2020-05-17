const MongoClient = require('mongodb').MongoClient
// make sure environment file is loaded
require('dotenv').config()

const url = process.env.MONGO_URL
const connectOptions = {
  useNewUrlParser: true,
  poolSize: 5, 
  useUnifiedTopology: true
}

// global clients
const clients = {}

// create connection pool
function getClient (db) {
  return new Promise((resolve, reject) => {
    if (!url) {
      reject('process.env.MONGO_URL is not defined. please add this to the .env file.')
    }
    // return existing global client connection
    if (clients[db]) {
      resolve(clients[db])
    } else {
      // connect and then return new global client connection
      try {
        MongoClient.connect(url, connectOptions, function(connectError, dbClient) {
          if (connectError) {
            reject(connectError)
          } else {
            console.log('cloud mongo db connected')
            clients[db] = dbClient
            resolve(clients[db])
          }
        })
      } catch (e) {
        reject(e)
      }
    }
  })
}

function find (db, collection, query = {}, projection) {
  return new Promise((resolve, reject) => {
    // get mongo client
    getClient(db)
    .then(client => {
      client.db(db).collection(collection)
      .find(query).project(projection)
      .toArray(function (queryError, doc) {
        // close the client connection
        client.close()
        // check for error
        if (queryError) reject(queryError)
        // success
        else resolve(doc)
      })
    })
    .catch(e => {
      // failed to get client
      reject(e)
    })
  })
}

// mongo find one (returns object)
function findOne (db, collection, query, options) {
  return new Promise((resolve, reject) => {
    // get mongo client
    getClient(db)
    .then(client => {
      // find one!
      client.db(db).collection(collection).findOne(query, options, function (err, result) {
        // close the client connection
        client.close()
        // check for error
        if (err) reject(err)
        // success
        else resolve(result)
      })
    })
    .catch(e => {
      // failed to get client
      reject(e)
    })
  })
}

// mongo insert
function insertOne (db, collection, data) {
  return new Promise((resolve, reject) => {
    // get mongo client
    getClient(db)
    .then(client => {
      // insert!
      client.db(db).collection(collection).insertOne(data, function (err, result) {
        // close the client connection
        client.close()
        // check for error
        if (err) reject(err)
        // success
        else resolve(result)
      })
    })
    .catch(e => {
      // failed to get client
      reject(e)
    })
  })
}

// mongo upsert (update existing or insert new if not exist)
function upsert (db, collection, query, data) {
  return new Promise((resolve, reject) => {
    // get mongo client
    getClient(db)
    .then(client => {
      // upsert!
      client.db(db).collection(collection).findOneAndReplace(query, data, { upsert: true }, function (err, result) {
        // close the client connection
        client.close()
        // check for error
        if (err) reject(err)
        // success
        else resolve(result)
      })
    })
    .catch(e => {
      // failed to get client
      reject(e)
    })
  })
}

// mongo updateOne (update one existing record)
function updateOne (db, collection, filter, query) {
  return new Promise((resolve, reject) => {
    // get mongo client
    getClient(db)
    .then(client => {
      // update one
      client.db(db).collection(collection).updateOne(filter, query, function (err, result) {
        // close the client connection
        client.close()
        // check for error
        if (err) reject(err)
        // success
        else resolve(result)
      })
    })
    .catch(e => {
      // failed to get client
      reject(e)
    })
  })
}

function removeOne (db, collection, query) {
  return new Promise((resolve, reject) => {
    // get mongo client
    getClient(db)
    .then(client => {
      // go
      client.db(db).collection(collection).removeOne(query, function (err, result) {
        // close the client connection
        client.close()
        // check for error
        if (err) reject(err)
        // success
        else resolve(result)
      })
    })
    .catch(e => {
      // failed to get client
      reject(e)
    })
  })
}

module.exports = {
  // client,
  // connect,
  find,
  findOne,
  // update,
  updateOne,
  upsert,
  insertOne,
  // remove,
  removeOne
}
