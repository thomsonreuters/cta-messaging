/**
 * This source code is provided under the Apache 2.0 license and is provided
 * AS IS with no warranty or guarantee of fit for purpose. See the project's
 * LICENSE.md for details.
 * Copyright 2017 Thomson Reuters. All rights reserved.
 */

'use strict';

const Providers = require('./providers');
const common = require('cta-common');

/**
 * Messaging tool
 * @param {object} dependencies
 * @param {object} configuration
 * @param {object} configuration.properties
 * @param {string} configuration.properties.provider - provider name, see supported providers list
 * @param {object} configuration.properties.parameters - provider parameters, refer to provider's doc
 * @constructor
 */
function Messaging(dependencies, configuration) {
  const _dependencies = common.validate(dependencies, {
    type: 'object',
    optional: true,
    defaultTo: {},
  }).output;
  const _configuration = common.validate(configuration, {
    type: 'object',
    optional: true,
    defaultToOptionals: true,
    items: {
      name: { type: 'string', optional: true, defaultTo: 'cta-messaging' },
      properties: { type: 'object', optional: true, defaultTo: { provider: 'rabbitmq' } },
      singleton: { type: 'boolean', optional: true, defaultTo: true },
    },
  }).output;
  return new Providers[_configuration.properties.provider](_dependencies, _configuration);
}

module.exports = Messaging;
