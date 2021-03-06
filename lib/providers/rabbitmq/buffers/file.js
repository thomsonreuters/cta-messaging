/**
 * This source code is provided under the Apache 2.0 license and is provided
 * AS IS with no warranty or guarantee of fit for purpose. See the project's
 * LICENSE.md for details.
 * Copyright 2017 Thomson Reuters. All rights reserved.
 */

'use strict';

const Nedb = require('nedb');
const path = require('path');
const common = require('cta-common');
const defaults = require('../config.defaults');

class FileBuffer {
  /**
   * class constructor
   * @param {object} config - configuration object
   * - location: path to a buffer.db file
   * - flushInterval: interval in ms for flushing the buffer
   * - flushThreshold: max number of messages in buffer, buffer will be flushed when it reaches this size
   * @param {object} provider
   * @param {object} logger
   */
  constructor(config, provider, logger) {
    this.config = common.validate(config, {
      type: 'object',
      optional: true,
      defaultToOptionals: true,
      items: {
        location: {
          optional: true,
          type: 'path',
          defaultTo: defaults.buffer.location,
        },
        flushInterval: {
          optional: true,
          type: 'number',
          defaultTo: defaults.buffer.flushInterval,
        },
        flushThreshold: {
          optional: true,
          type: 'number',
          defaultTo: defaults.buffer.flushThreshold,
        },
      },
    }).output;
    this.provider = provider;
    this.logger = logger;
    this.data = {
      queue: {},
      topic: {},
    };
    this.interval = null;
    const filename = path.join(this.config.location, 'buffer.db');
    this.logger.info(`using file buffer ${filename}`);
    this.buffer = new Nedb({
      filename: filename,
      autoload: true,
    });
  }

  /**
   * append message to buffer
   * @param {object} vp - validated parameters for provider method
   * @param {string} type - topic or queue
   * @returns {Promise}
   */
  append(vp, type) {
    const that = this;
    return new Promise((resolve, reject) => {
      try {
        that._init(type);
        const key = (type === 'queue' ? vp.queue : (vp.exchange + (vp.topic ? ('-' + vp.topic) : '')));
        if (!that.data[type].hasOwnProperty(key)) {
          that.data[type][key] = 0;
        }
        that.buffer.insert({
          type: type,
          key: key,
          params: vp,
        }, (insertErr) => {
          if (insertErr) {
            reject(insertErr);
          } else {
            that.data[type][key]++;
            if (that.data[type][key] < that.config.flushThreshold) {
              that.logger.info(`queue counter ${that.data[type][key]}`);
            } else {
              that._produce(key, type);
            }
            resolve();
          }
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * init buffer
   * @param {string} type - topic or queue
   * @private
   */
  _init(type) {
    const that = this;
    if (that.interval === null) {
      that.logger.info(`setting flush interval to run each ${that.config.flushInterval} ms`);
      that.interval = setInterval(() => {
        Object.keys(that.data[type]).forEach((key) => {
          that._produce(key, type);
        });
      }, that.config.flushInterval);
      // Retrieve remaining data (when app starts after crash/stop)
      // TODO should run this before any produce/publish method
      that.buffer.find({}, (err, docs) => {
        if (err) {
          that.logger.error(err);
          return;
        }
        docs.forEach((doc) => {
          if (!that.data[doc.type].hasOwnProperty(doc.key)) {
            that.data[doc.type][doc.key] = 1;
          } else {
            that.data[doc.type][doc.key]++;
          }
        });
      });
    }
  }

  /**
   * send to rabbitmq
   * @param {string} key - queue or exchange-topic
   * @param {string} type - queue or topic
   * @private
   */
  _produce(key, type) {
    const that = this;
    // TODO lock per type & key
    if (that.lockRead === true) {
      that.logger.info('read file is locked');
      return;
    }
    try {
      that.lockRead = true;
      that.buffer.find({
        type: type,
        key: key,
      })
      .limit(that.config.flushThreshold)
      .exec((findErr, docs) => {
        if (findErr) {
          that.lockRead = false;
          that.logger.error(findErr);
          return;
        }
        const messages = docs.map((doc) => {
          return doc.params.content;
        });
        if (messages.length > 0 && type === 'queue') {
          that.provider.produce({
            queue: key,
            content: {
              messages: messages,
            },
            buffer: 'none',
          }).then(() => {
            that.logger.info(`produced ${docs.length} messages from file buffer`);
            const ids = docs.map((doc) => {
              return {_id: doc._id};
            });
            that.buffer.remove({$or: ids}, {multi: true}, (removeErr, total) => {
              if (removeErr) {
                that.lockRead = false;
                that.logger.error(removeErr);
                return;
              }
              that.logger.info(`removed ${total} messages from file buffer`);
              that.data[type][key] -= total;
              that.lockRead = false;
            });
          }).catch((produceErr) => {
            that.lockRead = false;
            that.logger.error(produceErr);
          });
        } else if (messages.length > 0 && type === 'topic') {
          const exchange = docs[0].params.exchange;
          const topic = docs[0].params.topic;
          that.provider.publish({
            exchange: exchange,
            topic: topic,
            content: {
              messages: messages,
            },
            buffer: 'none',
          }).then(() => {
            that.logger.info(`published ${docs.length} messages from file buffer`);
            const ids = docs.map((doc) => {
              return { _id: doc._id };
            });
            that.buffer.remove({$or: ids}, { multi: true }, (removeErr, total) => {
              if (removeErr) {
                that.lockRead = false;
                that.logger.error(removeErr);
                return;
              }
              that.logger.info(`removed ${total} messages from file buffer`);
              that.data[type][key] -= total;
              that.lockRead = false;
            });
          }).catch((publishErr) => {
            that.lockRead = false;
            that.logger.error(publishErr);
          });
        } else {
          that.lockRead = false;
        }
      });
    } catch (e) {
      that.lockRead = false;
    }
  }
}

module.exports = FileBuffer;
