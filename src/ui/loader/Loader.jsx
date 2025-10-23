import './Loader.scss';

export default function Loader({ size = 'md' }) {
    return (<div className={`loader spinner spinner--${size}`} />);
}