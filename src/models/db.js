/*
This provides some simple async methods for using a mongo database
*/
const MongoClient = require('mongodb').MongoClient

// Connection URL
const url = process.env.MONGO_URL
const connectOptions = { useNewUrlParser: true }
module.exports = {
  find,
  findOne,
  insertOne,
  upsert,
  updateOne,
  removeOne
}

// get authenticated mongo client
function getClient () {
  return new Promise(function(resolve, reject) {
    // connect to mongo
    MongoClient.connect(url, { useNewUrlParser: true }, function(err, client) {
      // check for error
      if (err) return reject(err)
      // success - return client
      else resolve(client)
    })
  })
}

function find (collection, query = {}, projections) {
  return new Promise((resolve, reject) => {
    // get mongo client
    getClient()
    .then(client => {
      // use db already specified in connect url
      const db = client.db()
      // find!
      db.collection(collection)
      .find(query).project(projections)
      .toArray(function(queryError, doc) {
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
function findOne (collection, query, options) {
  return new Promise(function(resolve, reject) {
    // get mongo client
    getClient()
    .then(client => {
      // use db already specified in connect url
      const db = client.db()
      // find!
      db.collection(collection).findOne(query, options, function (err, result) {
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
function insertOne (collection, data) {
  return new Promise(function(resolve, reject) {
    // get mongo client
    getClient()
    .then(client => {
      // use db already specified in connect url
      const db = client.db()
      // insert!
      db.collection(collection).insertOne(data, function (err, result) {
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
function upsert (collection, query, data) {
  return new Promise(function(resolve, reject) {
    // get mongo client
    getClient()
    .then(client => {
      // use db already specified in connect url
      const db = client.db()
      // upsert!
      db.collection(collection).findOneAndReplace(query, data, { upsert: true }, function (err, result) {
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
function updateOne (collection, query, data) {
  return new Promise(function(resolve, reject) {
    // get mongo client
    getClient()
    .then(client => {
      // use db already specified in connect url
      const db = client.db()
      // upsert!
      db.collection(collection).updateOne(query, data, function (err, result) {
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

function removeOne (collection, query) {
  return new Promise((resolve, reject) => {
    // get mongo client
    getClient()
    .then(client => {
      // use db already specified in connect url
      const db = client.db()
      // go
      db.collection(collection).removeOne(query, function (err, result) {
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
