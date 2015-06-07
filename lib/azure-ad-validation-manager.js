var jsonwebtoken    = require('jsonwebtoken');
var restler         = require('restler');

function AzureActiveDirectoryValidationManager() {
    var self = this;

    function convertCertificateToBeOpenSSLCompatible(cert) {
        //Certificate must be in this specific format or else the function won't accept it
        var beginCert = "-----BEGIN CERTIFICATE-----";
        var endCert = "-----END CERTIFICATE-----";

        cert = cert.replace("\n", "");
        cert = cert.replace(beginCert, "");
        cert = cert.replace(endCert, "");

        var result = beginCert;
        while (cert.length > 0) {

            if (cert.length > 64) {
                result += "\n" + cert.substring(0, 64);
                cert = cert.substring(64, cert.length);
            }
            else {
                result += "\n" + cert;
                cert = "";
            }
        }

        if (result[result.length ] != "\n")
            result += "\n";
        result += endCert + "\n";
        return result;
    }

    /*
     * Extracts the tenant id from the give jwt token
     */
    self.getTenantId = function(jwtString) {
        return jsonwebtoken.decode(jwtString).tid;
    }

    /*
     * This function loads the open-id configuration for a specific AAD tenant
     * from a well known application.
     */
    self.requestOpenIdConfig = function(tenantId, cb) {
        // we need to load the tenant specific open id config
        var tenantOpenIdconfig = 'https://login.windows.net/' + tenantId + '/.well-known/openid-configuration';

        restler.get(tenantOpenIdconfig).on('complete', function(result) {
            if (result instanceof Error) {
                cb(result);
            } else {
                cb(null, result);
            }
        });
    };

    /*
     * Download the signing certificates which is the public portion of the
     * keys used to sign the JWT token.
     */
    self.requestSigningCertificates = function(jwtSigningKeysLocation, cb) {

        restler.get(jwtSigningKeysLocation).on('complete', function(result) {
            if (result instanceof Error) {
                cb(result);
            } else {

                var certificates = [];

                // visit the keys collection and extract the delivered certificates
                result.keys.forEach(function(publicKeys) {
                    publicKeys.x5c.forEach(function(certificate) {
                        certificates.push(convertCertificateToBeOpenSSLCompatible(certificate));
                    })
                });

                // good to go
                cb(null, certificates);
            }
        });
    };

    /*
     * This function tries to verify the token with every certificate until
     * all certificates was testes or the first one matches. After that the token is valid
     */
    self.verify = function(jwt, certificates, options, cb) {

        // ensure we have options
        if (!options) options = {};

        // set the correct algorithm
        options.algorithms = ['RS256'];

        // set the issuer we expect
        options.issuer = 'https://sts.windows.net/' + self.getTenantId(jwt) + '/';

        var valid = false;
        var lastError = null;

        certificates.every(function(certificate) {

            // verify the token
            try {
                // verify the token
                jsonwebtoken.verify(jwt, certificate, options);

                // set the state
                valid = true;
                lastError = null;

                // abort the enumeration
                return false;
            } catch(error) {

                // set teh error state
                lastError = error;

                // check if we should try the next certificate
                if (error.message === 'invalid signature') {
                    return true;
                } else {
                    return false;
                }
            }
        });

        // done
        cb(lastError, valid);
    }
}

module.exports = exports = AzureActiveDirectoryValidationManager;