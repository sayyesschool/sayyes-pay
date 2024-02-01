import { render } from 'react-dom';

import App from './App';

import './index.scss';

fetch('data.json')
    .then(res => res.json())
    .then(data => render(
        <App data={data} />,
        document.querySelector('#app')
    ));