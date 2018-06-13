// make the facebook users db unique for a pageId/userId combination
db.facebook.users.createIndex({userId: 1, pageId: 1}, {unique: true})
// and for session/datacenter combination
db.facebook.users.createIndex({session: 1, datacenter: 1}, {unique: true})

db.facebook.users.insert({"session" : "92565", "datacenter" : "SJC", "pageId" : "103018720547240", "userId" : "1731829546905168"})
