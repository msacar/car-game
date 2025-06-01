const path = require('path');

module.exports = {
    entry: './src/client/game.ts',
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: {
                    loader: 'ts-loader',
                    options: {
                        configFile: 'tsconfig.client.json'
                    }
                },
                exclude: /node_modules/,
            },
        ],
    },
    resolve: {
        extensions: ['.tsx', '.ts', '.js'],
        alias: {
            '@types': path.resolve(__dirname, 'src/types'),
        },
    },
    output: {
        filename: 'game.js',
        path: path.resolve(__dirname, 'public/js'),
    },
    externals: {
        'socket.io-client': 'io'
    },
    devtool: 'source-map'
};