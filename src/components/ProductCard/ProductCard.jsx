import {
    Button,
    Card,
    Typography
} from 'mdc-react';

import './ProductCard.scss';

const ProductCard = ({ format, onSelect }) => (
    <Card className="product-card">
        <Card.Media
            imageUrl={`/images/${format.id}.jpg`}
            wide
        />

        <Card.Header
            title={format.title}
        />

        <Card.Section primary>
            <Typography variant="body1" noMargin>{format.description}</Typography>
        </Card.Section>

        <Card.Actions>
            <Card.Action>
                <Button onClick={() => onSelect(format)}>Выбрать и оплатить</Button>
            </Card.Action>
        </Card.Actions>
    </Card >
);

export default ProductCard;