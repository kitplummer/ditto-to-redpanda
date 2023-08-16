import { init, Ditto, Document, TransportConfig } from '@dittolive/ditto'
require('dotenv').config()

let ditto

let rawSubscription
let rawLiveQuery
let rawDocuments: Document[] = []

let productSubscription
let productLiveQuery
let productDocuments: Document[] = []

let APP_ID = process.env.APP_ID
//let OFFLINE_TOKEN = process.env.OFFLINE_TOKEN
//let SHARED_KEY = process.env.SHARED_KEY
let APP_TOKEN = process.env.APP_TOKEN
let RAW_COLLECTION_NAME = process.env.RAW_COLLECTION_NAME
let PRODUCT_COLLECTION_NAME = process.env.PRODUCT_COLLECTION_NAME
let RAW_TOPIC_NAME = process.env.RAW_TOPIC_NAME
let PRODUCT_TOPIC_NAME = process.env.PRODUCT_TOPIC_NAME

const { Kafka, CompressionTypes, logLevel } = require('kafkajs')
const ip = require('ip')
const host = process.env.HOST_IP || ip.address()

const kafka = new Kafka({
  logLevel: logLevel.DEBUG,
  brokers: [`${host}:9092`],
  clientId: 'ditto-producer',
})

async function main() {
  await init()

  const config = new TransportConfig()
  config.peerToPeer.bluetoothLE.isEnabled = true
  config.peerToPeer.lan.isEnabled = false
  config.peerToPeer.awdl.isEnabled = false

  ditto = new Ditto({ type: 'onlinePlayground',
	  appID: APP_ID,
	  token: APP_TOKEN
  })

  const transportConditionsObserver = ditto.observeTransportConditions((condition, source) => {
     if (condition === 'BLEDisabled') {
       console.log('BLE disabled')
     } else if (condition === 'NoBLECentralPermission') {
       console.log('Permission missing for BLE')
     } else if (condition === 'NoBLEPeripheralPermission') {
       console.log('Permissions missing for BLE')
     }
   })

  ditto.setTransportConfig(config)

  const producer = kafka.producer()
  await producer.connect()
  ditto.startSync()
  
  rawSubscription = ditto.store.collection(RAW_COLLECTION_NAME).find("synced == false").subscribe()
  let rawDocuments: Document[] =[]

  rawLiveQuery = ditto.store
    .collection(RAW_COLLECTION_NAME)
    .find("synced == false")
    .observeLocalWithNextSignal(async (docs, event, signalNext) => {
      for (let i = 0; i < docs.length; i++) {
        const rawDoc = docs[i]
	console.log("RAW DOC: ", rawDoc.value)
        // Send to RedPanda topic
	console.log("Sending to RedPanda!")
        await producer.send({
          topic: RAW_TOPIC_NAME,
          messages: [
            { value: JSON.stringify(rawDoc.value) }
          ],
        })
        await ditto.store.collection(RAW_COLLECTION_NAME).findByID(rawDoc.id).update((mutableDoc) => {
          mutableDoc.at('synced').set(true)
        }) 
        // Set synced, and evict
      }
      await ditto.store.collection(RAW_COLLECTION_NAME).find("synced == true").evict()
      signalNext()
    })

  productSubscription = ditto.store.collection(PRODUCT_COLLECTION_NAME).find("synced == false").subscribe()
  productLiveQuery = ditto.store
    .collection(PRODUCT_COLLECTION_NAME)
    .find("synced == false")
    .observeLocalWithNextSignal(async (docs, event, signalNext) => {
      for (let i = 0; i < docs.length; i++) {
        const productDoc = docs[i]
        console.log("PRODUCT DOC to RedPanda: ", productDoc)
        producer.send({
          topic: PRODUCT_TOPIC_NAME,
          messages: [
            { value: JSON.stringify(productDoc.value) }
          ],
        })
        await ditto.store.collection(PRODUCT_COLLECTION_NAME).findByID(productDoc.id).update((mutableDoc) => {
          mutableDoc.at('synced').set(true)
        }) 
        // Set synced, and evict
      }
      ditto.store.collection(PRODUCT_COLLECTION_NAME).find("synced == true").evict()
      signalNext()
    })

  const presenceObserver = ditto.presence.observe((graph) => {
    if (graph.localPeer.connections.length != 0) {
      graph.localPeer.connections.forEach((connection) => {

        console.log("local peer connection: ", connection.id)
      })
    }
  })

}

main()
